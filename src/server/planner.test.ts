import { describe, expect, it } from "vitest";
import type { VideoBrief } from "../shared/video.js";
import type { PlannerConfig } from "./provider-settings.js";
import { createPlan, getPlannerStatus, summarizeExperience } from "./planner.js";

const baseBrief: VideoBrief = {
  topic: "为什么睡眠影响记忆",
  keywords: ["睡眠", "记忆", "大脑"],
  style: "flat-explainer",
  audience: "普通成年人",
  tone: "清晰、轻松",
  duration: 30,
  aspectRatio: "9:16"
};

describe("createPlan", () => {
  it("reports only the supplied planner configuration", () => {
    const planner: PlannerConfig = {
      provider: "deepseek",
      apiKey: "personal-key",
      baseUrl: "https://api.deepseek.com/v1",
      model: "personal-model",
      supportsJsonMode: true,
      disableThinking: false
    };
    expect(getPlannerStatus(planner)).toEqual({ connected: true, provider: "deepseek", model: "personal-model" });
    expect(getPlannerStatus()).toEqual({ connected: false, provider: "local" });
  });

  it("creates a valid 30 second storyboard with meaningful shots", async () => {
    const plan = await createPlan(baseBrief);
    const totalDuration = plan.shots.reduce((sum, shot) => sum + shot.duration, 0);

    expect(plan.shots.length).toBeGreaterThanOrEqual(5);
    expect(plan.shots.length).toBeLessThanOrEqual(10);
    expect(totalDuration).toBeCloseTo(30, 1);
    expect(plan.shots.every((shot) => shot.narration.replace(/[\p{P}\p{S}]/gu, "").length > 1)).toBe(true);
    expect(plan.shots.every((shot) => shot.duration >= 3)).toBe(true);
    expect(plan.planner).toBe("local-template");
    expect(plan.shots.every((shot) => shot.visualPrompt.includes("禁止血液、手术、解剖切面"))).toBe(true);
    expect(plan.shots.every((shot) => shot.visualPrompt.includes("禁止任何文字、数字、图表"))).toBe(true);
  });

  it("uses supplied copy and keeps the result under 60 seconds", async () => {
    const plan = await createPlan({
      ...baseBrief,
      duration: 60,
      sourceText: "睡眠期间，大脑会整理白天获得的信息。稳定的睡眠有助于记忆巩固。长期睡眠不足可能影响注意力和学习效率。保持规律作息，是支持认知状态的重要生活方式。"
    });
    const totalDuration = plan.shots.reduce((sum, shot) => sum + shot.duration, 0);

    expect(plan.script).toContain("大脑会整理");
    expect(totalDuration).toBeLessThanOrEqual(60.01);
    expect(plan.shots.length).toBeGreaterThanOrEqual(5);
  });

  it("records reuse of a successful prior plan", async () => {
    const priorPlan = await createPlan(baseBrief);
    const plan = await createPlan(baseBrief, { jobId: "prior-job", score: 8, plan: priorPlan });

    expect(plan.experienceUsed).toBe("prior-job");
    expect(plan.shots.length).toBe(priorPlan.shots.length);
    expect(summarizeExperience({ jobId: "prior-job", score: 8, plan: priorPlan })?.shots[0]).toEqual(expect.objectContaining({ headline: priorPlan.shots[0].headline, duration: priorPlan.shots[0].duration }));
  });
});
