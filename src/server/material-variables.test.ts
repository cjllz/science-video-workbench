import { describe, expect, it } from "vitest";
import type { MaterialAsset, ShotMaterialBinding } from "../shared/video.js";
import { extractMaterialVariables, resolveMaterialVariables } from "./material-variables.js";

const materials: MaterialAsset[] = [
  {
    id: "image-1",
    variableName: "血压监测仪",
    name: "monitor.png",
    kind: "image",
    mimeType: "image/png",
    size: 1200,
    url: "/materials/image-1/monitor.png",
    createdAt: "2026-08-03T00:00:00.000Z"
  },
  {
    id: "video-1",
    variableName: "诊室运镜",
    name: "room.mp4",
    kind: "video",
    mimeType: "video/mp4",
    size: 2200,
    url: "/materials/video-1/room.mp4",
    publicUrl: "https://example.com/room.mp4",
    createdAt: "2026-08-03T00:00:00.000Z"
  },
  {
    id: "data-1",
    variableName: "七日血压数据",
    name: "blood-pressure.xlsx",
    kind: "data",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: 3200,
    url: "/materials/data-1/blood-pressure.xlsx",
    createdAt: "2026-08-03T00:00:00.000Z"
  }
];

const bindings: ShotMaterialBinding[] = [
  { materialId: "image-1", variableName: "血压监测仪", role: "subject", mode: "ai_reference", placement: "center" },
  { materialId: "video-1", variableName: "诊室运镜", role: "motion", mode: "ai_reference", placement: "full" },
  {
    materialId: "data-1",
    variableName: "七日血压数据",
    role: "data",
    mode: "data_chart",
    placement: "top-right",
    chart: { type: "line", xColumn: "日期", yColumns: ["收缩压", "舒张压"] }
  }
];

describe("material variables", () => {
  it("extracts unique variables in first-use order", () => {
    expect(extractMaterialVariables("展示 @血压监测仪，再参考 @诊室运镜；最后再次出现 @血压监测仪。"))
      .toEqual(["血压监测仪", "诊室运镜"]);
  });

  it("rewrites AI references and keeps deterministic materials local", () => {
    const result = resolveMaterialVariables(
      "医生拿起 @血压监测仪，运镜参考 @诊室运镜，右上角展示 @七日血压数据。",
      bindings,
      materials
    );

    expect(result.prompt).toContain("@图片1");
    expect(result.prompt).toContain("@视频1");
    expect(result.prompt).not.toContain("@七日血压数据");
    expect(result.providerReferences.map((item) => item.material.id)).toEqual(["image-1", "video-1"]);
    expect(result.localBindings.map((item) => item.binding.materialId)).toEqual(["data-1"]);
    expect(result.unresolved).toEqual([]);
  });

  it("reports variables that are not bound to a material", () => {
    const result = resolveMaterialVariables("展示 @不存在的设备。", [], materials);
    expect(result.unresolved).toEqual(["不存在的设备"]);
  });
});
