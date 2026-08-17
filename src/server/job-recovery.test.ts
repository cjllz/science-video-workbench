import { describe, expect, it } from "vitest";
import type { VideoJob, VideoPlan } from "../shared/video.js";
import { interruptedJobPatch, isInterruptedStatus, retryPhase } from "./job-recovery.js";

const plan: VideoPlan = {
  title: "测试计划",
  script: "测试旁白",
  hook: "测试",
  shots: []
};

function job(status: VideoJob["status"], jobPlan: VideoPlan | undefined = plan): VideoJob {
  return {
    id: "job-recovery-test",
    brief: {
      topic: "测试主题",
      keywords: [],
      style: "flat-explainer",
      audience: "普通成年人",
      tone: "清晰",
      duration: 30,
      aspectRatio: "9:16"
    },
    status,
    progress: 50,
    currentStage: "处理中",
    plan: jobPlan,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z"
  };
}

describe("job restart recovery", () => {
  it("identifies queued and active jobs as interrupted", () => {
    for (const status of ["queued", "planning", "narrating", "rendering", "quality_check"] as const) {
      expect(isInterruptedStatus(status)).toBe(true);
      expect(interruptedJobPatch(job(status))).toMatchObject({ status: "failed", progress: 0 });
    }
    expect(isInterruptedStatus("complete")).toBe(false);
    expect(interruptedJobPatch(job("failed"))).toBeUndefined();
  });

  it("retries a failed job according to whether a plan exists", () => {
    expect(retryPhase(job("failed", plan))).toBe("rendering");
    expect(retryPhase({ ...job("failed"), plan: undefined })).toBe("planning");
  });

  it("rejects retrying a non-failed job", () => {
    expect(() => retryPhase(job("complete"))).toThrow("只有失败任务可以重试");
  });
});
