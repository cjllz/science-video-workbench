import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import type { MaterialAsset } from "../shared/video.js";
import { createMaterialAsset, deleteMaterialAsset, getMaterialAsset, listMaterialAssets, updateMaterialVariable } from "./db.js";

describe("material persistence", () => {
  it("stores, retrieves, lists, and renames a material", () => {
    const id = nanoid(12);
    const asset: MaterialAsset = {
      id,
      variableName: `设备_${id}`,
      name: "device.png",
      kind: "image",
      mimeType: "image/png",
      size: 128,
      url: `/materials/${id}/source.png`,
      createdAt: new Date().toISOString()
    };

    createMaterialAsset(asset, `C:/tmp/${id}/source.png`);
    expect(getMaterialAsset(id)).toEqual(asset);
    expect(listMaterialAssets().some((item) => item.id === id)).toBe(true);
    expect(updateMaterialVariable(id, `监测仪_${id}`).variableName).toBe(`监测仪_${id}`);
    deleteMaterialAsset(id);
  });
});
