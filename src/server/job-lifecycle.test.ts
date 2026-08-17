import { describe, expect, it } from "vitest";
import type { VideoJob } from "../shared/video.js";
import { assertPlanEditable, assertRenderable } from "./job-lifecycle.js";

function job(status: VideoJob["status"], withPlan = true): VideoJob {
  return {
    id: "job-1",
    brief: { topic: "减药科普", keywords: [], style: "flat-explainer", audience: "成年人", tone: "清晰", duration: 30, aspectRatio: "9:16" },
    status,
    progress: 0,
    currentStage: "测试",
    plan: withPlan ? { title: "剧本", hook: "开场", script: "旁白", shots: [] } : undefined,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z"
  };
}

describe("two-phase job lifecycle", () => {
  it("allows plan editing only while awaiting confirmation", () => {
    expect(() => assertPlanEditable(job("awaiting_confirmation"))).not.toThrow();
    expect(() => assertPlanEditable(job("rendering"))).toThrow("待确认");
  });

  it("requires an awaiting plan before rendering", () => {
    expect(() => assertRenderable(job("awaiting_confirmation"))).not.toThrow();
    expect(() => assertRenderable(job("awaiting_confirmation", false))).toThrow("剧本");
    expect(() => assertRenderable(job("planning"))).toThrow("确认");
  });
});
