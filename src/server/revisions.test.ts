import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import type { VideoPlan, VideoRevision } from "../shared/video.js";
import { createJobRevision, deleteJobRevision, listJobRevisions } from "./db.js";
import { archiveCurrentRevision, loadCachedGeneratedAssets, restoreArchivedRevision } from "./revisions.js";

const plan: VideoPlan = {
  title: "测试", hook: "测试", script: "测试",
  shots: [
    { id: "shot-1", index: 0, duration: 5, headline: "一", narration: "一", visualPrompt: "一", assetType: "generated_video", status: "complete", retryCount: 0 },
    { id: "shot-2", index: 1, duration: 5, headline: "二", narration: "二", visualPrompt: "二", assetType: "generated_video", status: "complete", retryCount: 0 },
    { id: "shot-3", index: 2, duration: 5, headline: "三", narration: "三", visualPrompt: "三", assetType: "data_visualization", status: "complete", retryCount: 0 }
  ]
};

describe("retouch revisions", () => {
  it("reuses cached generated clips except for the selected regeneration target", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "retouch-cache-"));
    try {
      await fs.writeFile(path.join(directory, "provider-0.mp4"), "first");
      await fs.writeFile(path.join(directory, "provider-1.mp4"), "second");
      const assets = await loadCachedGeneratedAssets(plan, directory, "shot-2");
      expect(assets[0]).toEqual(expect.objectContaining({ kind: "video", provider: "cache" }));
      expect(assets[1]).toEqual({ kind: "motion_card", provider: "local" });
      expect(assets[2]).toEqual({ kind: "motion_card", provider: "local" });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("persists revision metadata for rollback", () => {
    const jobId = `job-${nanoid(8)}`;
    const revision: VideoRevision = {
      id: nanoid(10), jobId, plan, outputUrl: `/outputs/${jobId}/revisions/v1/video.mp4`,
      posterUrl: `/outputs/${jobId}/revisions/v1/poster.png`, subtitleUrl: `/outputs/${jobId}/revisions/v1/captions.srt`,
      createdAt: new Date().toISOString()
    };
    try {
      createJobRevision(revision);
      expect(listJobRevisions(jobId)).toContainEqual(revision);
    } finally {
      deleteJobRevision(revision.id);
    }
  });

  it("archives and restores the provider asset manifest", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "retouch-revision-"));
    const jobId = `job-${nanoid(8)}`;
    try {
      await fs.writeFile(path.join(directory, "video.mp4"), "video");
      await fs.writeFile(path.join(directory, "provider-assets.json"), JSON.stringify({ shots: { "shot-1": { filename: "provider-0.mp4" } } }));
      const revision = await archiveCurrentRevision({
        id: jobId,
        brief: { topic: "测试", keywords: [], style: "flat-explainer", audience: "成人", tone: "清晰", duration: 30, aspectRatio: "16:9" },
        status: "complete", progress: 100, currentStage: "完成", plan, outputUrl: `/outputs/${jobId}/video.mp4`,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }, directory);
      await fs.writeFile(path.join(directory, "provider-assets.json"), "changed");
      await restoreArchivedRevision(revision, directory);
      expect(await fs.readFile(path.join(directory, "provider-assets.json"), "utf8")).toContain("shot-1");
      deleteJobRevision(revision.id);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
