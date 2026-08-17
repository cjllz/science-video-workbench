import { describe, expect, it } from "vitest";
import type { MaterialAsset, ShotMaterialBinding } from "../shared/video";
import {
  applyMaterialPurpose,
  createDefaultBinding,
  getMaterialPurpose,
  getMaterialPurposeOptions,
  replaceBindingMaterial
} from "./material-bindings";

const base: Omit<MaterialAsset, "id" | "variableName" | "name" | "kind" | "mimeType"> = {
  size: 100,
  url: "/materials/source",
  createdAt: "2026-08-03T00:00:00.000Z"
};

const image: MaterialAsset = { ...base, id: "image-1", variableName: "设备", name: "device.png", kind: "image", mimeType: "image/png" };
const replacementImage: MaterialAsset = { ...base, id: "image-2", variableName: "新设备", name: "new-device.png", kind: "image", mimeType: "image/png" };
const data: MaterialAsset = {
  ...base,
  id: "data-1",
  variableName: "随访数据",
  name: "follow-up.csv",
  kind: "data",
  mimeType: "text/csv",
  dataAsset: {
    id: "data-asset-1",
    name: "follow-up.csv",
    columns: ["日期", "收缩压"],
    rows: [["第一天", 130]],
    rowCount: 1,
    numericColumns: ["收缩压"],
    summary: "1 row",
    createdAt: "2026-08-03T00:00:00.000Z"
  }
};

describe("retouch material bindings", () => {
  it("uses exact overlays for images and local charts for data", () => {
    expect(createDefaultBinding(image, 6)).toEqual(expect.objectContaining({
      materialId: "image-1",
      role: "replacement",
      mode: "exact_overlay",
      placement: "full",
      startOffset: 0,
      endOffset: 6
    }));
    expect(createDefaultBinding(data, 8)).toEqual(expect.objectContaining({
      role: "data",
      mode: "data_chart",
      placement: "top-right",
      chart: { type: "line", xColumn: "日期", yColumns: ["收缩压"] }
    }));
  });

  it("replaces material identity while preserving timing and placement", () => {
    const binding: ShotMaterialBinding = {
      ...createDefaultBinding(image, 6),
      placement: "bottom-left",
      startOffset: 1.2,
      endOffset: 4.8
    };
    expect(replaceBindingMaterial(binding, replacementImage)).toEqual(expect.objectContaining({
      materialId: "image-2",
      variableName: "新设备",
      placement: "bottom-left",
      startOffset: 1.2,
      endOffset: 4.8
    }));
  });

  it("offers simple purposes based on the material kind", () => {
    expect(getMaterialPurposeOptions(image)).toEqual([
      ["integrate", "融入画面"],
      ["exact", "原样展示"]
    ]);
    expect(getMaterialPurposeOptions(data)).toEqual([["data", "展示数据"]]);
  });

  it("maps simple purposes to provider modes without losing advanced settings", () => {
    const binding: ShotMaterialBinding = {
      ...createDefaultBinding(image, 6),
      placement: "bottom-left",
      startOffset: 1.2,
      endOffset: 4.8
    };

    const integrated = applyMaterialPurpose(binding, image, "integrate");
    expect(integrated).toEqual(expect.objectContaining({
      role: "replacement",
      mode: "ai_reference",
      placement: "bottom-left",
      startOffset: 1.2,
      endOffset: 4.8
    }));
    expect(getMaterialPurpose(integrated)).toBe("integrate");

    const exact = applyMaterialPurpose(integrated, image, "exact");
    expect(exact).toEqual(expect.objectContaining({ mode: "exact_overlay" }));
    expect(getMaterialPurpose(exact)).toBe("exact");
  });

  it("keeps a full-shot interval when data is attached", () => {
    const binding = createDefaultBinding(data, 8);
    expect(getMaterialPurpose(binding)).toBe("data");
    expect(binding).toEqual(expect.objectContaining({ startOffset: 0, endOffset: 8 }));
  });
});
