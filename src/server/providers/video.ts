import fs from "node:fs/promises";
import path from "node:path";
import type { MaterialAsset, ShotPlan, VideoBrief } from "../../shared/video.js";
import { resolveMaterialVariables } from "../material-variables.js";

export type GeneratedAsset =
  | { kind: "video"; path: string; provider: string; sourceUrl?: string; sourceExpiresAt?: string }
  | { kind: "motion_card"; provider: "local" };

export interface VideoProviderStatus {
  connected: boolean;
  provider: "ark" | "http" | "local";
  model?: string;
  maxGeneratedShots: number;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function download(url: string, destination: string): Promise<void> {
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
  throw lastError;
}

async function arkRequest(pathname: string, init?: RequestInit): Promise<ArkTask> {
  const apiKey = process.env.ARK_API_KEY;
  if (!apiKey) throw new Error("ARK_API_KEY is not configured");
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
      if (!response.ok) throw new Error(`Ark ${payload.error?.code ?? response.status}: ${payload.error?.message ?? "request failed"}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < maximumAttempts - 1) await delay(1_500 * (attempt + 1));
    }
  }
  throw lastError;
}

export function buildArkGenerationRequest(
  brief: VideoBrief,
  shot: ShotPlan,
  materials: MaterialAsset[],
  providerUrls: Map<string, string>
): ArkGenerationRequest {
  const model = process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-mini-260615";
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
  referenceVideoUrl: string
): ArkGenerationRequest {
  const request = buildArkGenerationRequest(brief, shot, materials, providerUrls);
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

async function runArkVideoRequest(request: ArkGenerationRequest, shot: ShotPlan, outputDirectory: string): Promise<GeneratedAsset> {
  const created = await arkRequest("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(request)
  });
  if (!created.id) throw new Error("Ark did not return a task id");

  let task = created;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(5_000);
    task = await arkRequest(`/contents/generations/tasks/${created.id}`, { method: "GET" });
    if (task.status === "succeeded") break;
    if (["failed", "cancelled", "expired"].includes(task.status ?? "")) {
      throw new Error(`Ark task ${task.status}: ${task.error?.message ?? created.id}`);
    }
  }
  if (task.status !== "succeeded" || !task.content?.video_url) throw new Error(`Ark task timed out: ${created.id}`);

  const destination = path.join(outputDirectory, `provider-${shot.index}.mp4`);
  await download(task.content.video_url, destination);
  return {
    kind: "video",
    path: destination,
    provider: `ark:${request.model}`,
    sourceUrl: task.content.video_url,
    sourceExpiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
  };
}

async function generateWithArk(brief: VideoBrief, shot: ShotPlan, outputDirectory: string, materials: MaterialAsset[]): Promise<GeneratedAsset> {
  const request = buildArkGenerationRequest(brief, shot, materials, await materialProviderUrls(materials));
  return runArkVideoRequest(request, shot, outputDirectory);
}

export async function editShotAsset(
  brief: VideoBrief,
  shot: ShotPlan,
  outputDirectory: string,
  materials: MaterialAsset[],
  referenceVideoUrl: string
): Promise<GeneratedAsset> {
  if (!process.env.ARK_API_KEY) throw new Error("Seedance 视频编辑需要配置 ARK_API_KEY");
  const request = buildArkVideoEditRequest(brief, shot, materials, await materialProviderUrls(materials), referenceVideoUrl);
  return runArkVideoRequest(request, shot, outputDirectory);
}

async function generateWithHttp(brief: VideoBrief, shot: ShotPlan, outputDirectory: string): Promise<GeneratedAsset> {
  const endpoint = process.env.VIDEO_PROVIDER_URL!;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.VIDEO_PROVIDER_API_KEY ? { Authorization: `Bearer ${process.env.VIDEO_PROVIDER_API_KEY}` } : {})
    },
    body: JSON.stringify({
      prompt: shot.visualPrompt,
      duration: Math.min(15, Math.ceil(shot.duration)),
      aspectRatio: brief.aspectRatio,
      metadata: { topic: brief.topic, shotIndex: shot.index }
    }),
    signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) throw new Error(`Video provider failed: ${response.status}`);

  const destination = path.join(outputDirectory, `provider-${shot.index}.mp4`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("video/")) {
    await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
    return { kind: "video", path: destination, provider: "http" };
  }
  const payload = await response.json() as ProviderResponse;
  if (!payload.videoUrl) throw new Error("Video provider response did not include videoUrl");
  await download(payload.videoUrl, destination);
  return { kind: "video", path: destination, provider: "http", sourceUrl: payload.videoUrl };
}

export function getVideoProviderStatus(): VideoProviderStatus {
  const maxGeneratedShots = Math.max(1, Math.min(6, Number(process.env.ARK_MAX_GENERATED_SHOTS || 3)));
  if (process.env.ARK_API_KEY) {
    return { connected: true, provider: "ark", model: process.env.ARK_VIDEO_MODEL || "doubao-seedance-2-0-mini-260615", maxGeneratedShots };
  }
  if (process.env.VIDEO_PROVIDER_URL) return { connected: true, provider: "http", maxGeneratedShots };
  return { connected: false, provider: "local", maxGeneratedShots: 0 };
}

export async function generateShotAsset(brief: VideoBrief, shot: ShotPlan, outputDirectory: string, materials: MaterialAsset[] = []): Promise<GeneratedAsset> {
  if (process.env.ARK_API_KEY) return generateWithArk(brief, shot, outputDirectory, materials);
  if (process.env.VIDEO_PROVIDER_URL) return generateWithHttp(brief, shot, outputDirectory);
  return { kind: "motion_card", provider: "local" };
}
