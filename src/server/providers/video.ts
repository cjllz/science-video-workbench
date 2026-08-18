import fs from "node:fs/promises";
import path from "node:path";
import type { MaterialAsset, ShotPlan, VideoBrief } from "../../shared/video.js";
import { resolveMaterialVariables } from "../material-variables.js";
import type { VideoProviderConfig } from "../provider-settings.js";

export type GeneratedAsset =
  | { kind: "video"; path: string; provider: string; sourceUrl?: string; sourceExpiresAt?: string }
  | { kind: "motion_card"; provider: "local" };

export interface VideoProviderStatus {
  connected: boolean;
  provider: "ark" | "http" | "local";
  model?: string;
  maxGeneratedShots: number;
}

export type ProviderFailureKind = "authentication" | "quota" | "timeout" | "unavailable";

export class ProviderRequestError extends Error {
  readonly name = "ProviderRequestError";

  constructor(
    public readonly provider: "ark" | "http",
    public readonly kind: ProviderFailureKind,
    message: string
  ) {
    super(message);
  }
}

interface ProviderResponse {
  videoUrl?: string;
}

interface ArkTask {
  id: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
  content?: { video_url?: string };
  error?: { code?: string; message?: string };
}

type ArkContent =
  | { type: "text"; text: string }
  | { type: "image_url" | "video_url" | "audio_url"; image_url?: { url: string }; video_url?: { url: string }; audio_url?: { url: string }; role?: "first_frame" | "last_frame" | "reference_video" };

export interface ArkGenerationRequest {
  model: string;
  content: ArkContent[];
  duration: number;
  ratio: VideoBrief["aspectRatio"];
  resolution: "720p";
  watermark: false;
  generate_audio?: false;
}

const arkBaseUrl = "https://ark.cn-beijing.volces.com/api/v3";
const localVideoConfig: VideoProviderConfig = { provider: "local", maxGeneratedShots: 0 };

function providerError(
  provider: "ark" | "http",
  status?: number,
  cause?: unknown
): ProviderRequestError {
  const label = provider === "ark" ? "Seedance" : "视频服务";
  if (status === 401 || status === 403) return new ProviderRequestError(provider, "authentication", `${label}认证失败`);
  if (status === 429) return new ProviderRequestError(provider, "quota", `${label}配额不足或请求过于频繁`);
  if (cause instanceof Error && ["AbortError", "TimeoutError"].includes(cause.name)) {
    return new ProviderRequestError(provider, "timeout", `${label}请求超时`);
  }
  return new ProviderRequestError(provider, "unavailable", `${label}暂时不可用`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function download(url: string, destination: string, provider: "ark" | "http"): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) throw new Error(`Video download failed: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(destination, bytes);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await delay(1_500 * (attempt + 1));
    }
  }
  throw providerError(provider, undefined, lastError);
}

async function arkRequest(apiKey: string, pathname: string, init?: RequestInit): Promise<ArkTask> {
  const maximumAttempts = init?.method === "GET" ? 3 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const response = await fetch(`${arkBaseUrl}${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init?.headers ?? {})
        },
        signal: AbortSignal.timeout(30_000)
      });
      const payload = await response.json().catch(() => ({})) as ArkTask & { error?: { code?: string; message?: string } };
      if (!response.ok) throw providerError("ark", response.status);
      return payload;
    } catch (error) {
      lastError = error instanceof ProviderRequestError ? error : providerError("ark", undefined, error);
      if (attempt < maximumAttempts - 1) await delay(1_500 * (attempt + 1));
    }
  }
  throw lastError;
}

export function buildArkGenerationRequest(
  brief: VideoBrief,
  shot: ShotPlan,
  materials: MaterialAsset[],
  providerUrls: Map<string, string>,
  config: Extract<VideoProviderConfig, { provider: "ark" }>
): ArkGenerationRequest {
  const model = config.model;
  const resolution = resolveMaterialVariables(shot.visualPrompt, shot.materialBindings ?? [], materials);
  if (resolution.unresolved.length) throw new Error(`镜头存在未绑定素材：${resolution.unresolved.map((name) => `@${name}`).join("、")}`);
  const content: ArkContent[] = [{ type: "text", text: resolution.prompt }];
  for (const reference of resolution.providerReferences) {
    const url = providerUrls.get(reference.material.id);
    if (!url) throw new Error(`素材 @${reference.material.variableName} 无法提供给 Seedance，请配置公网地址或改用精确叠加`);
    const role = reference.binding.role === "first_frame" || reference.binding.role === "last_frame"
      ? reference.binding.role
      : undefined;
    if (reference.material.kind === "image") content.push({ type: "image_url", image_url: { url }, ...(role ? { role } : {}) });
    if (reference.material.kind === "video") content.push({ type: "video_url", video_url: { url } });
    if (reference.material.kind === "audio") content.push({ type: "audio_url", audio_url: { url } });
  }
  return {
    model,
    content,
    duration: Math.max(4, Math.min(15, Math.round(shot.duration))),
    ratio: brief.aspectRatio,
    resolution: "720p",
    watermark: false,
    ...(model.includes("seedance-2-0") ? { generate_audio: false } : {})
  };
}

export function buildArkVideoEditRequest(
  brief: VideoBrief,
  shot: ShotPlan,
  materials: MaterialAsset[],
  providerUrls: Map<string, string>,
  referenceVideoUrl: string,
  config: Extract<VideoProviderConfig, { provider: "ark" }>
): ArkGenerationRequest {
  const request = buildArkGenerationRequest(brief, shot, materials, providerUrls, config);
  return {
    ...request,
    content: [...request.content, { type: "video_url", video_url: { url: referenceVideoUrl }, role: "reference_video" }]
  };
}

async function materialProviderUrls(materials: MaterialAsset[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const material of materials) {
    if (material.publicUrl) urls.set(material.id, material.publicUrl);
  }
  return urls;
}

async function runArkVideoRequest(
  request: ArkGenerationRequest,
  shot: ShotPlan,
  outputDirectory: string,
  config: Extract<VideoProviderConfig, { provider: "ark" }>
): Promise<GeneratedAsset> {
  const created = await arkRequest(config.apiKey, "/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(request)
  });
  if (!created.id) throw providerError("ark");

  let task = created;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(5_000);
    task = await arkRequest(config.apiKey, `/contents/generations/tasks/${created.id}`, { method: "GET" });
    if (task.status === "succeeded") break;
    if (["failed", "cancelled", "expired"].includes(task.status ?? "")) {
      throw providerError("ark", task.error?.code?.toLowerCase().includes("quota") ? 429 : undefined);
    }
  }
  if (task.status !== "succeeded" || !task.content?.video_url) {
    throw new ProviderRequestError("ark", "timeout", "Seedance请求超时");
  }

  const destination = path.join(outputDirectory, `provider-${shot.index}.mp4`);
  await download(task.content.video_url, destination, "ark");
  return {
    kind: "video",
    path: destination,
    provider: `ark:${request.model}`,
    sourceUrl: task.content.video_url,
    sourceExpiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
  };
}

async function generateWithArk(
  brief: VideoBrief,
  shot: ShotPlan,
  outputDirectory: string,
  materials: MaterialAsset[],
  config: Extract<VideoProviderConfig, { provider: "ark" }>
): Promise<GeneratedAsset> {
  const request = buildArkGenerationRequest(brief, shot, materials, await materialProviderUrls(materials), config);
  return runArkVideoRequest(request, shot, outputDirectory, config);
}

export async function editShotAsset(
  brief: VideoBrief,
  shot: ShotPlan,
  outputDirectory: string,
  materials: MaterialAsset[],
  referenceVideoUrl: string,
  config: VideoProviderConfig = localVideoConfig
): Promise<GeneratedAsset> {
  if (config.provider !== "ark") throw new Error("Seedance 视频编辑需要配置 Ark 视频服务");
  const request = buildArkVideoEditRequest(brief, shot, materials, await materialProviderUrls(materials), referenceVideoUrl, config);
  return runArkVideoRequest(request, shot, outputDirectory, config);
}

async function generateWithHttp(
  brief: VideoBrief,
  shot: ShotPlan,
  outputDirectory: string,
  config: Extract<VideoProviderConfig, { provider: "http" }>
): Promise<GeneratedAsset> {
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify({
        prompt: shot.visualPrompt,
        duration: Math.min(15, Math.ceil(shot.duration)),
        aspectRatio: brief.aspectRatio,
        metadata: { topic: brief.topic, shotIndex: shot.index }
      }),
      signal: AbortSignal.timeout(180_000)
    });
  } catch (error) {
    throw providerError("http", undefined, error);
  }
  if (!response.ok) throw providerError("http", response.status);

  const destination = path.join(outputDirectory, `provider-${shot.index}.mp4`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("video/")) {
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    return { kind: "video", path: destination, provider: "http" };
  }
  const payload = await response.json() as ProviderResponse;
  if (!payload.videoUrl) throw providerError("http");
  await download(payload.videoUrl, destination, "http");
  return { kind: "video", path: destination, provider: "http", sourceUrl: payload.videoUrl };
}

export function getVideoProviderStatus(config: VideoProviderConfig = localVideoConfig): VideoProviderStatus {
  if (config.provider === "ark") {
    return { connected: true, provider: "ark", model: config.model, maxGeneratedShots: config.maxGeneratedShots };
  }
  if (config.provider === "http") return { connected: true, provider: "http", maxGeneratedShots: config.maxGeneratedShots };
  return { connected: false, provider: "local", maxGeneratedShots: 0 };
}

export async function generateShotAsset(
  brief: VideoBrief,
  shot: ShotPlan,
  outputDirectory: string,
  materials: MaterialAsset[] = [],
  config: VideoProviderConfig = localVideoConfig
): Promise<GeneratedAsset> {
  if (config.provider === "ark") return generateWithArk(brief, shot, outputDirectory, materials, config);
  if (config.provider === "http") return generateWithHttp(brief, shot, outputDirectory, config);
  return { kind: "motion_card", provider: "local" };
}
