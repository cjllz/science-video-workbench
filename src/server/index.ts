import fs from "node:fs";
import type { Server } from "node:http";
import path from "node:path";
import { loadEnvFile } from "node:process";
import express from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import { z } from "zod";
import { VIDEO_STYLES, type ShotRetouchInput, type VideoJob, type VideoPlan } from "../shared/video.js";
import { createLanAuth } from "./auth.js";
import { registerLanAuthRoutes, requireLanAuth, requireTrustedMutation } from "./auth-http.js";
import { parseDataAsset } from "./data-assets.js";
import { addFeedback, checkDatabase, closeDatabase, createDataAsset, createJob, getDataAssets, getJob, getJobRevision, getLearningStats, getMaterialAssets, listJobRevisions, listJobs, listMaterialAssets, recordEvent, updateJob, updateMaterialVariable } from "./db.js";
import { assertPlanEditable, assertRenderable } from "./job-lifecycle.js";
import { markInterruptedJobsFailed, retryPhase } from "./job-recovery.js";
import { classifyMaterial, storeMaterialUpload } from "./materials.js";
import { dataRoot, materialRoot, outputRoot, projectRoot } from "./paths.js";
import { configureRenderConcurrency, enqueuePlanning, enqueueRendering, enqueueRetouch, enqueueRetry, waitForPipelineIdle } from "./pipeline.js";
import { inspectPlanForRender } from "./preflight.js";
import { loadProviderAssetManifest, selectReferenceVideoUrl } from "./provider-assets.js";
import { authSessionForRequest, registerProviderSettingsRoutes } from "./provider-settings-http.js";
import { createProviderSettingsStore, resolveProviderConfig, type OperationProviderConfig } from "./provider-settings.js";
import { parseScriptImport } from "./script-imports.js";
import { applyShotRetouch, assertRetouchable, assertVideoEditSource, normalizeRetouchVisualAction } from "./retouch.js";
import { archiveCurrentRevision, restoreArchivedRevision } from "./revisions.js";
import { readRuntimeConfig } from "./runtime-config.js";
import { createDeploymentReadiness } from "./readiness.js";
import { createShutdownController } from "./shutdown.js";
import { getFfmpegPath } from "./tooling.js";

try {
  loadEnvFile();
} catch {
  // Environment variables can also be supplied by the hosting platform.
}

const runtimeConfig = readRuntimeConfig(process.env);
const app = express();
const lanAuth = createLanAuth(runtimeConfig.lanAccessToken);
const providerSettings = createProviderSettingsStore();
configureRenderConcurrency(runtimeConfig.maxConcurrentRenders);
if (runtimeConfig.trustProxy === 1) app.set("trust proxy", 1);
const readiness = createDeploymentReadiness({
  database: checkDatabase,
  dataDirectory: dataRoot,
  ffmpegPath: getFfmpegPath()
});
let server: Server | undefined;
const shutdown = createShutdownController({
  timeoutMs: 30_000,
  beginReadinessShutdown: readiness.beginShutdown,
  closeServer: () => new Promise<void>((resolve, reject) => {
    if (!server?.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  }),
  waitForWork: waitForPipelineIdle,
  closeDatabase
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension === ".csv" || extension === ".xlsx") callback(null, true);
    else callback(new Error("只支持 CSV 或 XLSX 文件"));
  }
});
const scriptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if ([".txt", ".md", ".docx"].includes(extension)) callback(null, true);
    else callback(new Error("只支持 TXT、Markdown 或 DOCX 剧本文件"));
  }
});
const materialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    try {
      classifyMaterial(file.originalname);
      callback(null, true);
    } catch (error) {
      callback(error instanceof Error ? error : new Error("不支持该素材格式"));
    }
  }
});
fs.mkdirSync(outputRoot, { recursive: true });
fs.mkdirSync(materialRoot, { recursive: true });

app.use(express.json({ limit: "1mb" }));
app.get("/api/health", (_request, response) => response.json({ ok: true }));
app.get("/api/ready", async (_request, response) => {
  const result = await readiness.inspect();
  return response.status(result.ok ? 200 : 503).json(result);
});
app.use("/api", requireTrustedMutation);
registerLanAuthRoutes(app, lanAuth, providerSettings.clear);
app.use("/api", requireLanAuth(lanAuth));
app.use("/api", (request, response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && !shutdown.acceptingWork()) {
    return response.status(503).json({ message: "服务器正在停止，暂不接受新操作" });
  }
  return next();
});
registerProviderSettingsRoutes(app, lanAuth, providerSettings, process.env);
app.use("/outputs", requireLanAuth(lanAuth), express.static(outputRoot, { maxAge: "1h", fallthrough: false }));
app.use("/materials", requireLanAuth(lanAuth), express.static(materialRoot, { maxAge: "1h", fallthrough: false }));

const briefSchema = z.object({
  topic: z.string().trim().min(2).max(80),
  keywords: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  style: z.enum(["medical-documentary", "flat-explainer", "news-explainer", "data-story", "real-life"]),
  audience: z.string().trim().min(2).max(60).default("普通成年人"),
  tone: z.string().trim().min(1).max(30).default("清晰、可信"),
  duration: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  generationMode: z.enum(["hybrid", "all-ai"]).default("hybrid"),
  sourceText: z.string().trim().max(30_000).optional(),
  dataAssetIds: z.array(z.string().min(6).max(40)).max(3).optional(),
  scriptMode: z.enum(["ai", "provided"]).default("ai")
});

const chartSchema = z.object({
  type: z.enum(["line", "bar", "table"]),
  xColumn: z.string().max(120),
  yColumns: z.array(z.string().max(120)).max(8)
});
const bindingSchema = z.object({
  materialId: z.string().min(6).max(40),
  variableName: z.string().regex(/^[\p{L}\p{N}_-]{1,40}$/u),
  role: z.enum(["subject", "scene", "first_frame", "last_frame", "replacement", "motion", "camera", "music", "voice", "rhythm", "data"]),
  mode: z.enum(["ai_reference", "exact_overlay", "data_chart"]),
  placement: z.enum(["full", "center", "top-left", "top-right", "bottom-left", "bottom-right"]),
  startOffset: z.number().min(0).max(60).optional(),
  endOffset: z.number().min(0).max(60).optional(),
  chart: chartSchema.optional()
});
const planSchema = z.object({
  title: z.string().trim().min(2).max(80),
  script: z.string().trim().min(2).max(30_000),
  hook: z.string().trim().min(1).max(300),
  planner: z.string().max(120).optional(),
  experienceUsed: z.string().max(40).optional(),
  shots: z.array(z.object({
    id: z.string().min(4).max(40),
    index: z.number().int().min(0).max(20),
    duration: z.number().min(1).max(60),
    narration: z.string().trim().min(1).max(500),
    headline: z.string().trim().min(1).max(80),
    visualPrompt: z.string().trim().min(1).max(2000),
    assetType: z.enum(["generated_video", "motion_card", "data_visualization"]),
    dataAssetId: z.string().max(40).optional(),
    status: z.enum(["pending", "rendering", "complete", "failed"]),
    retryCount: z.number().int().min(0).max(20),
    materialBindings: z.array(bindingSchema).max(20).optional()
  })).min(1).max(20)
});
const retouchSchema = z.object({
  shotId: z.string().min(4).max(40),
  visualAction: z.enum(["none", "edit", "regenerate"]).optional(),
  regenerateVisual: z.boolean().optional(),
  patch: z.object({
    headline: z.string().trim().min(1).max(80).optional(),
    narration: z.string().trim().min(1).max(500).optional(),
    visualPrompt: z.string().trim().min(1).max(2000).optional(),
    materialBindings: z.array(bindingSchema).max(20).optional()
  })
});

const feedbackSchema = z.object({
  accepted: z.boolean(),
  rating: z.number().int().min(1).max(5),
  notes: z.string().trim().max(1000).optional()
});

function providersFor(request: express.Request): OperationProviderConfig {
  const session = authSessionForRequest(request, lanAuth);
  return resolveProviderConfig(session ? providerSettings.get(session.id) : undefined, process.env);
}

app.get("/api/styles", (_request, response) => response.json(VIDEO_STYLES));
app.get("/api/stats", (_request, response) => response.json(getLearningStats()));
app.get("/api/provider", (request, response) => {
  const resolved = providersFor(request);
  return response.json({ ...resolved.view.video, planner: resolved.view.script });
});
app.post("/api/script-imports", scriptUpload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ message: "请选择剧本文件" });
  try {
    const text = await parseScriptImport(request.file.originalname, request.file.buffer);
    return response.status(201).json({ name: request.file.originalname, text });
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "剧本解析失败" });
  }
});
app.get("/api/materials", (_request, response) => response.json(listMaterialAssets()));
app.post("/api/materials", materialUpload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ message: "请选择素材文件" });
  try {
    const asset = await storeMaterialUpload(request.file.originalname, request.file.mimetype, request.file.buffer);
    return response.status(201).json(asset);
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "素材上传失败" });
  }
});
app.patch("/api/materials/:id", (request, response) => {
  const parsed = z.object({ variableName: z.string().trim().regex(/^[\p{L}\p{N}_-]{1,40}$/u) }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "素材变量名只能包含中文、字母、数字、下划线或短横线" });
  try {
    return response.json(updateMaterialVariable(request.params.id, parsed.data.variableName));
  } catch {
    return response.status(404).json({ message: "素材不存在" });
  }
});
app.post("/api/uploads", upload.single("file"), async (request, response) => {
  if (!request.file) return response.status(400).json({ message: "请选择数据文件" });
  try {
    const extension = path.extname(request.file.originalname).toLowerCase();
    const asset = await parseDataAsset(request.file.originalname, extension, request.file.buffer);
    createDataAsset(asset);
    return response.status(201).json(asset);
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "数据文件解析失败" });
  }
});
app.get("/api/jobs", (_request, response) => response.json(listJobs()));
app.get("/api/jobs/:id", (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  return response.json(job);
});

app.post("/api/jobs/:id/retry", (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  let phase: ReturnType<typeof retryPhase>;
  try {
    phase = retryPhase(job);
  } catch (error) {
    return response.status(409).json({ message: error instanceof Error ? error.message : "当前任务不可重试" });
  }
  const queued = updateJob(job.id, {
    status: "queued",
    progress: 0,
    currentStage: phase === "rendering" ? "等待重新生成" : "等待重新规划",
    error: undefined
  });
  enqueueRetry(job.id, providersFor(request));
  return response.status(202).json(queued);
});

app.post("/api/jobs", (request, response) => {
  const parsed = briefSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "输入信息不完整", issues: parsed.error.issues });
  const requestedAssets = parsed.data.dataAssetIds ?? [];
  if (getDataAssets(requestedAssets).length !== requestedAssets.length) return response.status(400).json({ message: "部分数据素材不存在，请重新上传" });
  const now = new Date().toISOString();
  const job: VideoJob = {
    id: nanoid(12),
    brief: parsed.data,
    status: "queued",
    progress: 0,
    currentStage: "等待生成",
    createdAt: now,
    updatedAt: now
  };
  createJob(job);
  enqueuePlanning(job.id, providersFor(request));
  return response.status(202).json(job);
});

app.patch("/api/jobs/:id/plan", (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  try {
    assertPlanEditable(job);
  } catch (error) {
    return response.status(409).json({ message: error instanceof Error ? error.message : "当前剧本不可编辑" });
  }
  const parsed = planSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "剧本格式不正确", issues: parsed.error.issues });
  const plan = parsed.data as VideoPlan;
  return response.json(updateJob(job.id, { plan, currentStage: "剧本修改已保存" }));
});

app.post("/api/jobs/:id/render", (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  try {
    assertRenderable(job);
  } catch (error) {
    return response.status(409).json({ message: error instanceof Error ? error.message : "当前任务不可生成" });
  }
  const materialIds = [...new Set(job.plan!.shots.flatMap((shot) => (shot.materialBindings ?? []).map((binding) => binding.materialId)))];
  const materials = getMaterialAssets(materialIds);
  const issues = inspectPlanForRender(job.plan!, materials, job.brief.duration);
  if (issues.length) return response.status(400).json({ message: "剧本预检未通过", issues });
  const queued = updateJob(job.id, { status: "queued", progress: 0, currentStage: "剧本已确认，等待生成", error: undefined });
  enqueueRendering(job.id, providersFor(request));
  return response.status(202).json(queued);
});

app.get("/api/jobs/:id/revisions", (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  return response.json(listJobRevisions(job.id));
});

app.post("/api/jobs/:id/retouch", async (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  try {
    assertRetouchable(job);
  } catch (error) {
    return response.status(409).json({ message: error instanceof Error ? error.message : "当前任务不可微调" });
  }
  const parsed = retouchSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "镜头微调参数不正确", issues: parsed.error.issues });
  try {
    const input = parsed.data as ShotRetouchInput;
    const visualAction = normalizeRetouchVisualAction(input);
    const plan = applyShotRetouch(job, input);
    const materialIds = [...new Set(plan.shots.flatMap((shot) => (shot.materialBindings ?? []).map((binding) => binding.materialId)))];
    const issues = inspectPlanForRender(plan, getMaterialAssets(materialIds), job.brief.duration);
    if (issues.length) return response.status(400).json({ message: "镜头微调预检未通过", issues });
    if (visualAction === "edit") {
      const target = plan.shots.find((shot) => shot.id === input.shotId)!;
      const directory = path.join(outputRoot, job.id);
      const manifest = await loadProviderAssetManifest(directory);
      const record = manifest.shots[target.id] ?? (fs.existsSync(path.join(directory, `provider-${target.index}.mp4`)) ? {
        shotId: target.id, index: target.index, filename: `provider-${target.index}.mp4`, provider: "cache", createdAt: job.updatedAt
      } : undefined);
      assertVideoEditSource(visualAction, selectReferenceVideoUrl(record, job.id));
    }
    await archiveCurrentRevision(job, path.join(outputRoot, job.id));
    const queued = updateJob(job.id, { status: "queued", progress: 0, currentStage: "镜头微调已提交", plan, error: undefined });
    enqueueRetouch(job.id, input.shotId, visualAction, providersFor(request));
    return response.status(202).json(queued);
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "镜头微调提交失败" });
  }
});

app.post("/api/jobs/:id/revisions/:revisionId/restore", async (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  if (!["complete", "failed"].includes(job.status)) return response.status(409).json({ message: "生成过程中不能回退版本" });
  const revision = getJobRevision(request.params.revisionId);
  if (!revision || revision.jobId !== job.id) return response.status(404).json({ message: "修订版本不存在" });
  try {
    await restoreArchivedRevision(revision, path.join(outputRoot, job.id));
    const restored = updateJob(job.id, {
      status: "complete", progress: 100, currentStage: "已回退到历史版本", plan: revision.plan,
      outputUrl: `/outputs/${job.id}/video.mp4`, posterUrl: `/outputs/${job.id}/shot-0.png`, subtitleUrl: `/outputs/${job.id}/captions.srt`, error: undefined
    });
    recordEvent(job.id, "revision.restored", { revisionId: revision.id });
    return response.json(restored);
  } catch (error) {
    return response.status(400).json({ message: error instanceof Error ? error.message : "版本回退失败" });
  }
});

app.post("/api/jobs/:id/feedback", (request, response) => {
  const job = getJob(request.params.id);
  if (!job) return response.status(404).json({ message: "任务不存在" });
  if (job.status !== "complete") return response.status(409).json({ message: "视频完成后才能提交反馈" });
  const parsed = feedbackSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ message: "反馈格式不正确", issues: parsed.error.issues });
  addFeedback(job.id, parsed.data);
  return response.status(201).json({ ok: true, stats: getLearningStats() });
});

const clientDist = path.join(projectRoot, "dist", "client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("/*splat", (_request, response) => response.sendFile(path.join(clientDist, "index.html")));
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError || error instanceof Error) {
    return response.status(400).json({ message: error.message });
  }
  console.error(error);
  return response.status(500).json({ message: "服务器处理失败" });
});

const interruptedJobCount = markInterruptedJobsFailed();

server = app.listen(runtimeConfig.port, runtimeConfig.host, () => {
  console.log(`Science video API listening on http://${runtimeConfig.host}:${runtimeConfig.port}`);
  if (interruptedJobCount) console.warn(`Marked ${interruptedJobCount} interrupted job(s) as failed after restart`);
  if (!lanAuth.enabled) console.warn("LAN_ACCESS_TOKEN is not configured; LAN authentication is disabled");
});

const handleShutdownSignal = (): void => {
  void shutdown.begin().then(
    ({ drained }) => {
      if (!drained) {
        console.warn("Shutdown deadline reached before active work completed");
        server?.closeAllConnections();
      }
      process.exitCode = 0;
    },
    (error: unknown) => {
      console.error("Graceful shutdown failed", error);
      process.exitCode = 1;
    }
  );
};

process.once("SIGTERM", handleShutdownSignal);
process.once("SIGINT", handleShutdownSignal);
