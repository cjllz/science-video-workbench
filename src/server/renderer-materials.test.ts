import { describe, expect, it } from "vitest";
import type { MaterialAsset, ShotPlan } from "../shared/video.js";
import { dataAssetForShot, overlayBindingsForShot, overlayEnableExpression } from "./renderer.js";

const material: MaterialAsset = {
  id: "material-data",
  variableName: "血压数据",
  name: "blood-pressure.csv",
  kind: "data",
  mimeType: "text/csv",
  size: 20,
  url: "/materials/material-data/source.csv",
  createdAt: "2026-08-03T00:00:00.000Z",
  dataAsset: {
    id: "parsed-data",
    name: "blood-pressure.csv",
    columns: ["日期", "收缩压", "舒张压"],
    rows: [["周一", 125, 80], ["周二", 121, 78]],
    rowCount: 2,
    numericColumns: ["收缩压", "舒张压"],
    summary: "两日数据",
    createdAt: "2026-08-03T00:00:00.000Z"
  }
};

const shot: ShotPlan = {
  id: "shot-data", index: 0, duration: 5, narration: "展示数据", headline: "趋势", visualPrompt: "展示 @血压数据",
  assetType: "data_visualization", status: "pending", retryCount: 0,
  materialBindings: [{
    materialId: material.id, variableName: material.variableName, role: "data", mode: "data_chart", placement: "full",
    chart: { type: "line", xColumn: "日期", yColumns: ["舒张压"] }
  }]
};

describe("renderer material data", () => {
  it("projects uploaded data to the fields selected in the script", () => {
    const selected = dataAssetForShot(shot, [material], []);
    expect(selected?.columns).toEqual(["日期", "舒张压"]);
    expect(selected?.rows).toEqual([["周一", 80], ["周二", 78]]);
    expect(selected?.numericColumns).toEqual(["舒张压"]);
  });

  it("limits an exact overlay to its relative shot interval", () => {
    expect(overlayEnableExpression({ ...shot.materialBindings![0], mode: "exact_overlay", startOffset: 1.5, endOffset: 4.25 }, 5)).toBe("enable='between(t,1.5,4.25)'");
    expect(overlayEnableExpression({ ...shot.materialBindings![0], mode: "exact_overlay" }, 5)).toBe("enable='between(t,0,5)'");
  });

  it("composites both exact media and data charts over generated video", () => {
    const chartShot = structuredClone(shot);
    chartShot.materialBindings![0].mode = "exact_overlay";
    chartShot.materialBindings!.push({
      materialId: "data-1", variableName: "趋势", role: "data", mode: "data_chart", placement: "top-right",
      startOffset: 0.5, endOffset: 4.5, chart: { type: "line", xColumn: "日期", yColumns: ["数值"] }
    });
    expect(overlayBindingsForShot(chartShot).map((binding) => binding.mode)).toEqual(["exact_overlay", "data_chart"]);
  });
});
