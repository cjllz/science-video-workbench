import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { deleteMaterialAsset, getMaterialStoragePath } from "./db.js";
import { classifyMaterial, createVariableName, storeMaterialUpload } from "./materials.js";

describe("material upload helpers", () => {
  it("classifies supported material extensions", () => {
    expect(classifyMaterial("设备.png")).toBe("image");
    expect(classifyMaterial("动作.mp4")).toBe("video");
    expect(classifyMaterial("配音.wav")).toBe("audio");
    expect(classifyMaterial("监测数据.xlsx")).toBe("data");
  });

  it("rejects unsupported executable files", () => {
    expect(() => classifyMaterial("payload.exe")).toThrow("不支持");
  });

  it("creates a readable variable name from the filename", () => {
    expect(createVariableName("  家用血压监测仪（正面）.png ")).toBe("家用血压监测仪_正面");
    expect(createVariableName("2026 report final.xlsx")).toBe("素材_2026_report_final");
  });

  it("stores and parses an uploaded CSV as a data material", async () => {
    const asset = await storeMaterialUpload(
      "七日监测.csv",
      "text/csv",
      Buffer.from("日期,收缩压,舒张压\n8月1日,125,80\n8月2日,120,78", "utf8")
    );

    const storagePath = getMaterialStoragePath(asset.id)!;
    try {
      expect(asset.kind).toBe("data");
      expect(asset.variableName).toBe("七日监测");
      expect(asset.dataAsset?.columns).toEqual(["日期", "收缩压", "舒张压"]);
      expect(fs.existsSync(storagePath)).toBe(true);
    } finally {
      deleteMaterialAsset(asset.id);
      fs.rmSync(path.dirname(storagePath), { recursive: true, force: true });
    }
  });
});
