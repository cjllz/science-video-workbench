import { describe, expect, it } from "vitest";
import type { VideoJob } from "../shared/video.js";
import { applyShotRetouch, assertRetouchable, assertVideoEditSource, normalizeRetouchVisualAction } from "./retouch.js";

const job: VideoJob = {
  id: "job-complete",
  brief: { topic: "安全减药", keywords: [], style: "flat-explainer", audience: "成年人", tone: "温和", duration: 30, aspectRatio: "9:16" },
  status: "complete",
  progress: 100,
  currentStage: "视频已生成",
  outputUrl: "/outputs/job-complete/video.mp4",
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  plan: {
    title: "安全减药", hook: "不要突然停药", script: "第一段第二段",
    shots: [
      { id: "shot-1", index: 0, duration: 12, headline: "先评估", narration: "第一段", visualPrompt: "医生解释", assetType: "generated_video", status: "complete", retryCount: 0 },
      { id: "shot-2", index: 1, duration: 18, headline: "再调整", narration: "第二段", visualPrompt: "患者记录", assetType: "generated_video", status: "complete", retryCount: 0 }
    ]
  }
};

describe("shot retouch rules", () => {
  it("allows only completed jobs with an existing output", () => {
    expect(() => assertRetouchable(job)).not.toThrow();
    expect(() => assertRetouchable({ ...job, status: "rendering" })).toThrow("完成");
    expect(() => assertRetouchable({ ...job, outputUrl: undefined })).toThrow("成片");
  });

  it("updates one complete shot while preserving timeline duration", () => {
    const plan = applyShotRetouch(job, { shotId: "shot-2", patch: { narration: "修改后的第二段", visualPrompt: "医生和患者查看记录" }, regenerateVisual: false });
    expect(plan.shots[0]).toEqual(job.plan!.shots[0]);
    expect(plan.shots[1].narration).toBe("修改后的第二段");
    expect(plan.script).toBe("第一段修改后的第二段");
    expect(plan.shots.reduce((sum, shot) => sum + shot.duration, 0)).toBe(30);
  });

  it("rejects material intervals outside the selected shot", () => {
    expect(() => applyShotRetouch(job, {
      shotId: "shot-1",
      regenerateVisual: false,
      patch: { materialBindings: [{ materialId: "material-1", variableName: "设备", role: "replacement", mode: "exact_overlay", placement: "center", startOffset: 8, endOffset: 13 }] }
    })).toThrow("素材出现区间");
  });

  it("normalizes legacy and explicit visual actions", () => {
    expect(normalizeRetouchVisualAction({ shotId: "shot-1", patch: {}, regenerateVisual: false })).toBe("none");
    expect(normalizeRetouchVisualAction({ shotId: "shot-1", patch: {}, regenerateVisual: true })).toBe("regenerate");
    expect(normalizeRetouchVisualAction({ shotId: "shot-1", patch: {}, visualAction: "edit" })).toBe("edit");
  });

  it("requires a provider-accessible source only for video editing", () => {
    expect(() => assertVideoEditSource("none", undefined)).not.toThrow();
    expect(() => assertVideoEditSource("regenerate", undefined)).not.toThrow();
    expect(() => assertVideoEditSource("edit", undefined)).toThrow("公网");
    expect(() => assertVideoEditSource("edit", "https://media.example.com/shot.mp4")).not.toThrow();
  });
});
