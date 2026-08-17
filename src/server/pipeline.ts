import fs from "node:fs/promises";
import path from "node:path";
import type { DataAsset, MaterialAsset, RetouchVisualAction, VideoJob, VideoPlan } from "../shared/video.js";
import { findExperience, getDataAssets, getJob, getMaterialAssets, recordEvent, updateJob } from "./db.js";
import { outputRoot } from "./paths.js";
import { createPlan } from "./planner.js";
import { editShotAsset, generateShotAsset, getVideoProviderStatus, type GeneratedAsset } from "./providers/video.js";
import { inspectVideo, renderVideo } from "./renderer.js";
import { loadProviderAssetManifest, saveProviderAssetRecord, selectReferenceVideoUrl } from "./provider-assets.js";
import { assertVideoEditSource } from "./retouch.js";
import { selectGeneratedShotIndices } from "./shot-policy.js";
import { loadCachedGeneratedAssets } from "./revisions.js";

const running = new Set<string>();

function publicPath(jobId: string, filename: string): string {
  return `/outputs/${jobId}/${filename}`;
}

function materialIds(plan: VideoPlan): string[] {
  return [...new Set(plan.shots.flatMap((shot) => (shot.materialBindings ?? []).map((binding) => binding.materialId)))];
}

function combinedDataAssets(job: VideoJob, materials: MaterialAsset[]): DataAsset[] {
  const direct = getDataAssets(job.brief.dataAssetIds ?? []);
  const attached = materials.flatMap((material) => material.dataAsset ? [material.dataAsset] : []);
  return [...new Map([...direct, ...attached].map((asset) => [asset.id, asset])).values()];
}

export function enqueuePlanning(jobId: string): void {
  const key = `planning:${jobId}`;
  if (running.has(key)) return;
  running.add(key);
  void processPlanning(jobId).finally(() => running.delete(key));
}

export function enqueueRendering(jobId: string): void {
  const key = `rendering:${jobId}`;
  if (running.has(key)) return;
  running.add(key);
  void processRendering(jobId).finally(() => running.delete(key));
}

export function enqueueRetouch(jobId: string, shotId: string, visualAction: RetouchVisualAction): void {
  const key = `retouch:${jobId}`;
  if (running.has(key)) return;
  running.add(key);
  void processRetouch(jobId, shotId, visualAction).finally(() => running.delete(key));
}

export const enqueueJob = enqueuePlanning;

async function processPlanning(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) return;

  try {
    updateJob(jobId, { status: "planning", progress: 8, currentStage: "正在理解主题和历史经验" });
    const experience = findExperience(job.brief);
    const dataAssets = getDataAssets(job.brief.dataAssetIds ?? []);
    const plan = await createPlan(job.brief, experience, dataAssets);
    updateJob(jobId, { status: "awaiting_confirmation", progress: 100, currentStage: "剧本已生成，请确认分镜和素材", plan });
    recordEvent(jobId, "plan.created", { plan, experience: experience?.jobId });
  } catch (error) {
    console.error(`Job ${jobId} planning failed`, error);
    updateJob(jobId, { status: "failed", currentStage: "剧本生成失败", error: error instanceof Error ? error.message : String(error) });
  }
}

async function processRendering(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job?.plan) return;
  const plan = job.plan;
  const directory = path.join(outputRoot, jobId);
  await fs.mkdir(directory, { recursive: true });

  try {
    const materials = getMaterialAssets(materialIds(plan));
    const dataAssets = combinedDataAssets(job, materials);

    updateJob(jobId, { status: "rendering", progress: 28, currentStage: "正在准备镜头素材" });
    const assets: GeneratedAsset[] = [];
    const provider = getVideoProviderStatus();
    const generationLimit = job.brief.generationMode === "all-ai" ? plan.shots.length : provider.maxGeneratedShots;
    const generatedIndices = selectGeneratedShotIndices(plan.shots, generationLimit);
    let generatedPosition = 0;
    for (const shot of plan.shots) {
      if (shot.assetType === "data_visualization") {
        assets.push({ kind: "motion_card", provider: "local" });
        recordEvent(jobId, "shot.data_visualization.prepared", { shotId: shot.id, dataAssetId: shot.dataAssetId });
        continue;
      }
      if (!generatedIndices.has(shot.index)) {
        assets.push({ kind: "motion_card", provider: "local" });
        recordEvent(jobId, "shot.asset.local_policy", { shotId: shot.id });
        continue;
      }
      try {
        generatedPosition += 1;
        updateJob(jobId, {
          status: "rendering",
          progress: 28 + Math.round((generatedPosition / Math.max(generatedIndices.size, 1)) * 8),
          currentStage: `Seedance 正在生成镜头 ${generatedPosition}/${generatedIndices.size}`
        });
        const asset = await generateShotAsset(job.brief, shot, directory, materials);
        assets.push(asset);
        if (asset.kind === "video") await saveProviderAssetRecord(directory, {
          shotId: shot.id, index: shot.index, filename: path.basename(asset.path), provider: asset.provider,
          sourceUrl: asset.sourceUrl, sourceExpiresAt: asset.sourceExpiresAt, createdAt: new Date().toISOString()
        });
        recordEvent(jobId, "shot.asset.created", { shotId: shot.id, provider: asset.provider, kind: asset.kind });
      } catch (error) {
        assets.push({ kind: "motion_card", provider: "local" });
        shot.retryCount += 1;
        recordEvent(jobId, "shot.asset.fallback", { shotId: shot.id, error: String(error) });
      }
    }

    updateJob(jobId, { status: "narrating", progress: 36, currentStage: "正在生成旁白、字幕和画面" });
    const result = await renderVideo(job.brief, plan, directory, assets, dataAssets, materials, (index) => {
      const progress = 40 + Math.round(((index + 1) / plan.shots.length) * 45);
      updateJob(jobId, { status: "rendering", progress, currentStage: `正在合成镜头 ${index + 1}/${plan.shots.length}` });
    });

    updateJob(jobId, { status: "quality_check", progress: 92, currentStage: "正在检查视频文件" });
    const inspection = await inspectVideo(result.outputPath);
    if (inspection.size < 10_000) throw new Error("Generated video file is unexpectedly small");
    if (inspection.duration <= 1 || inspection.duration > 60.5) throw new Error(`Generated duration is invalid: ${inspection.duration}s`);
    recordEvent(jobId, "quality_check.passed", inspection);

    updateJob(jobId, {
      status: "complete",
      progress: 100,
      currentStage: "视频已生成",
      plan,
      outputUrl: publicPath(jobId, "video.mp4"),
      posterUrl: publicPath(jobId, path.basename(result.posterPath)),
      subtitleUrl: publicPath(jobId, "captions.srt")
    });
  } catch (error) {
    console.error(`Job ${jobId} failed`, error);
    updateJob(jobId, { status: "failed", currentStage: "生成失败", error: error instanceof Error ? error.message : String(error) });
  }
}

async function processRetouch(jobId: string, shotId: string, visualAction: RetouchVisualAction): Promise<void> {
  const job = getJob(jobId);
  if (!job?.plan) return;
  const plan = job.plan;
  const directory = path.join(outputRoot, jobId);
  const materials = getMaterialAssets(materialIds(plan));
  const dataAssets = combinedDataAssets(job, materials);

  try {
    const stage = visualAction === "edit" ? "Seedance 正在编辑选中镜头" : visualAction === "regenerate" ? "正在重新生成选中镜头" : "正在应用镜头微调";
    updateJob(jobId, { status: "rendering", progress: 18, currentStage: stage });
    const assets = await loadCachedGeneratedAssets(plan, directory);
    const target = plan.shots.find((shot) => shot.id === shotId);
    if (!target) throw new Error("微调镜头不存在");

    if (visualAction === "edit" && target.assetType !== "data_visualization") {
      const current = assets[target.index];
      if (current?.kind !== "video") throw new Error("当前镜头没有可编辑的视频片段");
      const manifest = await loadProviderAssetManifest(directory);
      const record = manifest.shots[target.id] ?? {
        shotId: target.id, index: target.index, filename: path.basename(current.path), provider: current.provider, createdAt: job.updatedAt
      };
      const referenceUrl = selectReferenceVideoUrl(record, jobId);
      assertVideoEditSource(visualAction, referenceUrl);
      assets[target.index] = await editShotAsset(job.brief, target, directory, materials, referenceUrl!);
      const edited = assets[target.index];
      if (edited.kind === "video") await saveProviderAssetRecord(directory, {
        shotId: target.id, index: target.index, filename: path.basename(edited.path), provider: edited.provider,
        sourceUrl: edited.sourceUrl, sourceExpiresAt: edited.sourceExpiresAt, createdAt: new Date().toISOString()
      });
      recordEvent(jobId, "shot.retouch.edited", { shotId });
    } else if (visualAction === "regenerate" && target.assetType !== "data_visualization") {
      try {
        assets[target.index] = await generateShotAsset(job.brief, target, directory, materials);
        const generated = assets[target.index];
        if (generated.kind === "video") await saveProviderAssetRecord(directory, {
          shotId: target.id, index: target.index, filename: path.basename(generated.path), provider: generated.provider,
          sourceUrl: generated.sourceUrl, sourceExpiresAt: generated.sourceExpiresAt, createdAt: new Date().toISOString()
        });
        recordEvent(jobId, "shot.retouch.generated", { shotId });
      } catch (error) {
        const fallback = await loadCachedGeneratedAssets(plan, directory);
        assets[target.index] = fallback[target.index] ?? { kind: "motion_card", provider: "local" };
        recordEvent(jobId, "shot.retouch.fallback", { shotId, error: String(error) });
      }
    }

    updateJob(jobId, { status: "narrating", progress: 40, currentStage: "正在重新合成旁白、字幕和镜头" });
    const result = await renderVideo(job.brief, plan, directory, assets, dataAssets, materials, (index) => {
      updateJob(jobId, { status: "rendering", progress: 45 + Math.round(((index + 1) / plan.shots.length) * 40), currentStage: `正在合成镜头 ${index + 1}/${plan.shots.length}` });
    });
    updateJob(jobId, { status: "quality_check", progress: 92, currentStage: "正在检查修订成片" });
    const inspection = await inspectVideo(result.outputPath);
    if (inspection.size < 10_000 || inspection.duration <= 1 || inspection.duration > 60.5) throw new Error("修订成片质量检查未通过");
    recordEvent(jobId, "shot.retouch.completed", { shotId, visualAction, inspection });
    updateJob(jobId, {
      status: "complete", progress: 100, currentStage: "镜头微调已完成", plan,
      outputUrl: publicPath(jobId, "video.mp4"), posterUrl: publicPath(jobId, path.basename(result.posterPath)), subtitleUrl: publicPath(jobId, "captions.srt"), error: undefined
    });
  } catch (error) {
    console.error(`Job ${jobId} retouch failed`, error);
    updateJob(jobId, { status: "failed", currentStage: "镜头微调失败", error: error instanceof Error ? error.message : String(error) });
  }
}

export function resumeInterruptedJobs(): void {
  // Jobs are intentionally not auto-resumed yet; retry behavior will be added with persistent queueing.
}
