import { describe, expect, it } from "vitest";
import type { MaterialAsset, VideoPlan } from "../shared/video.js";
import { inspectPlanForRender } from "./preflight.js";

const dataMaterial: MaterialAsset = {
  id: "data-1",
  variableName: "七日数据",
  name: "data.xlsx",
  kind: "data",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size: 100,
  url: "/materials/data-1/source.xlsx",
  createdAt: "2026-08-03T00:00:00.000Z",
  dataAsset: {
    id: "parsed-data-1",
    name: "data.xlsx",
    columns: ["日期", "收缩压", "舒张压"],
    rows: [["8月1日", 125, 80], ["8月2日", 120, 78]],
    rowCount: 2,
    numericColumns: ["收缩压", "舒张压"],
    summary: "两日血压数据",
    createdAt: "2026-08-03T00:00:00.000Z"
  }
};

function plan(visualPrompt: string): VideoPlan {
  return {
    title: "测试剧本",
    hook: "开场",
    script: "旁白",
    shots: [{
      id: "shot-1",
      index: 0,
      duration: 30,
      headline: "数据",
      narration: "展示监测趋势",
      visualPrompt,
      assetType: "generated_video",
      status: "pending",
      retryCount: 0,
      materialBindings: visualPrompt.includes("@七日数据") ? [{
        materialId: "data-1",
        variableName: "七日数据",
        role: "data",
        mode: "data_chart",
        placement: "top-right",
        chart: { type: "line", xColumn: "日期", yColumns: ["收缩压", "舒张压"] }
      }] : []
    }]
  };
}

describe("render preflight", () => {
  it("reports an unresolved variable", () => {
    expect(inspectPlanForRender(plan("展示 @未知设备"), [], 30)).toContainEqual(expect.objectContaining({ code: "unresolved_variable" }));
  });

  it("reports a chart field that is absent from uploaded data", () => {
    const invalid = plan("展示 @七日数据");
    invalid.shots[0].materialBindings![0].chart!.yColumns = ["不存在"];
    expect(inspectPlanForRender(invalid, [dataMaterial], 30)).toContainEqual(expect.objectContaining({ code: "invalid_data_field" }));
  });

  it("accepts a valid variable-bound plan", () => {
    expect(inspectPlanForRender(plan("展示 @七日数据"), [dataMaterial], 30)).toEqual([]);
  });

  it("rejects AI video references that Seedance cannot fetch", () => {
    const video: MaterialAsset = { ...dataMaterial, id: "video-1", variableName: "设备演示", name: "demo.mp4", kind: "video", mimeType: "video/mp4", dataAsset: undefined };
    const videoPlan = plan("展示 @设备演示");
    videoPlan.shots[0].materialBindings = [{ materialId: video.id, variableName: video.variableName, role: "motion", mode: "ai_reference", placement: "full" }];
    expect(inspectPlanForRender(videoPlan, [video], 30)).toContainEqual(expect.objectContaining({ code: "provider_url_required" }));
  });

  it("rejects AI image references without a public URL", () => {
    const image: MaterialAsset = { ...dataMaterial, id: "image-1", variableName: "监测仪", name: "device.png", kind: "image", mimeType: "image/png", dataAsset: undefined };
    const imagePlan = plan("展示 @监测仪");
    imagePlan.shots[0].materialBindings = [{ materialId: image.id, variableName: image.variableName, role: "first_frame", mode: "ai_reference", placement: "full" }];
    expect(inspectPlanForRender(imagePlan, [image], 30)).toContainEqual(expect.objectContaining({ code: "provider_url_required" }));
  });
});
