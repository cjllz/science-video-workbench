import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { VideoJob, VideoPlan, VideoRevision } from "../shared/video.js";
import { createJobRevision } from "./db.js";
import type { GeneratedAsset } from "./providers/video.js";
import { loadProviderAssetManifest, providerAssetManifestName } from "./provider-assets.js";

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadCachedGeneratedAssets(plan: VideoPlan, directory: string, regenerateShotId?: string): Promise<GeneratedAsset[]> {
  const assets: GeneratedAsset[] = [];
  const manifest = await loadProviderAssetManifest(directory);
  for (const shot of plan.shots) {
    const providerPath = path.join(directory, `provider-${shot.index}.mp4`);
    if (shot.assetType !== "data_visualization" && shot.id !== regenerateShotId && await exists(providerPath)) {
      const record = manifest.shots[shot.id];
      assets.push({ kind: "video", path: providerPath, provider: "cache", sourceUrl: record?.sourceUrl, sourceExpiresAt: record?.sourceExpiresAt });
    } else {
      assets.push({ kind: "motion_card", provider: "local" });
    }
  }
  return assets;
}

async function copyIfPresent(source: string, destination: string): Promise<boolean> {
  if (!await exists(source)) return false;
  await fs.copyFile(source, destination);
  return true;
}

export async function archiveCurrentRevision(job: VideoJob, outputDirectory: string): Promise<VideoRevision> {
  if (!job.plan || !job.outputUrl) throw new Error("没有可归档的成片版本");
  const id = nanoid(10);
  const revisionDirectory = path.join(outputDirectory, "revisions", id);
  await fs.mkdir(revisionDirectory, { recursive: true });
  const outputUrl = `/outputs/${job.id}/revisions/${id}/video.mp4`;
  const posterSource = path.join(outputDirectory, job.posterUrl ? path.basename(job.posterUrl) : "shot-0.png");
  const posterCopied = await copyIfPresent(posterSource, path.join(revisionDirectory, "poster.png"));
  const subtitleCopied = await copyIfPresent(path.join(outputDirectory, "captions.srt"), path.join(revisionDirectory, "captions.srt"));
  if (!await copyIfPresent(path.join(outputDirectory, "video.mp4"), path.join(revisionDirectory, "video.mp4"))) {
    throw new Error("当前成片文件不存在，无法创建修订版本");
  }
  for (const filename of await fs.readdir(outputDirectory)) {
    if (/^provider-\d+\.mp4$/.test(filename)) await fs.copyFile(path.join(outputDirectory, filename), path.join(revisionDirectory, filename));
  }
  await copyIfPresent(path.join(outputDirectory, providerAssetManifestName), path.join(revisionDirectory, providerAssetManifestName));
  const revision: VideoRevision = {
    id,
    jobId: job.id,
    plan: structuredClone(job.plan),
    outputUrl,
    posterUrl: posterCopied ? `/outputs/${job.id}/revisions/${id}/poster.png` : undefined,
    subtitleUrl: subtitleCopied ? `/outputs/${job.id}/revisions/${id}/captions.srt` : undefined,
    createdAt: new Date().toISOString()
  };
  createJobRevision(revision);
  return revision;
}

export async function restoreArchivedRevision(revision: VideoRevision, outputDirectory: string): Promise<void> {
  const revisionDirectory = path.join(outputDirectory, "revisions", revision.id);
  if (!await copyIfPresent(path.join(revisionDirectory, "video.mp4"), path.join(outputDirectory, "video.mp4"))) {
    throw new Error("修订版本的成片文件不存在");
  }
  await copyIfPresent(path.join(revisionDirectory, "poster.png"), path.join(outputDirectory, "shot-0.png"));
  await copyIfPresent(path.join(revisionDirectory, "captions.srt"), path.join(outputDirectory, "captions.srt"));
  for (const filename of await fs.readdir(revisionDirectory)) {
    if (/^provider-\d+\.mp4$/.test(filename)) await fs.copyFile(path.join(revisionDirectory, filename), path.join(outputDirectory, filename));
  }
  await copyIfPresent(path.join(revisionDirectory, providerAssetManifestName), path.join(outputDirectory, providerAssetManifestName));
}
