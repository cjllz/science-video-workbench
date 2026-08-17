import { describe, expect, it } from "vitest";
import type { VideoBrief } from "../shared/video.js";
import { parseDataAsset } from "./data-assets.js";
import { createPlan } from "./planner.js";

describe("data assets", () => {
  it("parses CSV percentages without losing exact values", async () => {
    const asset = await parseDataAsset(
      "患病率.csv",
      ".csv",
      Buffer.from("年份,患病率\n2020,12.3%\n2022,14.8%\n2024,17.1%", "utf8")
    );

    expect(asset.columns).toEqual(["年份", "患病率"]);
    expect(asset.numericColumns).toContain("患病率");
    expect(asset.rows[0][1]).toBeCloseTo(0.123);
    expect(asset.summary).toContain("12.3%");
    expect(asset.summary).toContain("17.1%");
  });

  it("adds an uploaded dataset as a dedicated visualization shot", async () => {
    const asset = await parseDataAsset(
      "趋势.csv",
      ".csv",
      Buffer.from("年份,数值\n2021,10\n2022,14\n2023,18", "utf8")
    );
    const brief: VideoBrief = {
      topic: "一组健康数据发生了什么变化",
      keywords: ["趋势", "数据"],
      style: "data-story",
      audience: "普通成年人",
      tone: "清晰、可信",
      duration: 30,
      aspectRatio: "9:16",
      dataAssetIds: [asset.id]
    };

    const plan = await createPlan(brief, undefined, [asset]);
    const dataShot = plan.shots.find((shot) => shot.assetType === "data_visualization");

    expect(dataShot?.dataAssetId).toBe(asset.id);
    expect(dataShot?.narration).toBe(asset.summary);
    expect(plan.script).toContain(asset.summary);
  });
});
