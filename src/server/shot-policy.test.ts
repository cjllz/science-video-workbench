import { describe, expect, it } from "vitest";
import type { ShotPlan } from "../shared/video.js";
import { selectGeneratedShotIndices } from "./shot-policy.js";

function shots(count: number, dataIndex?: number): ShotPlan[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index), index, duration: 5, narration: "旁白", headline: "镜头", visualPrompt: "prompt",
    assetType: index === dataIndex ? "data_visualization" : "motion_card", status: "pending", retryCount: 0
  }));
}

describe("selectGeneratedShotIndices", () => {
  it("selects evenly distributed shots", () => {
    expect([...selectGeneratedShotIndices(shots(5), 3)]).toEqual([0, 2, 4]);
  });

  it("excludes exact data visualization shots", () => {
    expect([...selectGeneratedShotIndices(shots(5, 2), 3)]).toEqual([0, 3, 4]);
  });

  it("returns no shots when the provider is disabled", () => {
    expect(selectGeneratedShotIndices(shots(5), 0).size).toBe(0);
  });
});
