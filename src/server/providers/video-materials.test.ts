import { describe, expect, it } from "vitest";
import type { MaterialAsset, ShotPlan, VideoBrief } from "../../shared/video.js";
import { buildArkGenerationRequest, buildArkVideoEditRequest } from "./video.js";

const brief: VideoBrief = {
  topic: "正确减药",
  keywords: ["医患沟通"],
  style: "flat-explainer",
  audience: "慢病患者",
  tone: "温和",
  duration: 30,
  aspectRatio: "16:9",
  generationMode: "all-ai"
};

const image: MaterialAsset = {
  id: "material-device",
  variableName: "血压监测仪",
  name: "device.png",
  kind: "image",
  mimeType: "image/png",
  size: 100,
  url: "/materials/material-device/source.png",
  createdAt: "2026-08-03T00:00:00.000Z"
};

const shot: ShotPlan = {
  id: "shot-1",
  index: 0,
  duration: 6,
  narration: "医生结合监测数据解释减药条件。",
  headline: "先看监测结果",
  visualPrompt: "医生拿起 @血压监测仪 向患者解释",
  assetType: "generated_video",
  status: "pending",
  retryCount: 0,
  materialBindings: [{
    materialId: image.id,
    variableName: image.variableName,
    role: "first_frame",
    mode: "ai_reference",
    placement: "full"
  }]
};

describe("Seedance material request", () => {
  it("rewrites variables and attaches an ordered image reference", () => {
    const request = buildArkGenerationRequest(brief, shot, [image], new Map([[image.id, "data:image/png;base64,abc"]]));
    expect(request.content[0]).toEqual(expect.objectContaining({ type: "text", text: expect.stringContaining("@图片1") }));
    expect(request.content[1]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc" },
      role: "first_frame"
    });
    expect(request.duration).toBe(6);
  });

  it("keeps exact overlays out of the provider request", () => {
    const exactShot = structuredClone(shot);
    exactShot.materialBindings![0].mode = "exact_overlay";
    const request = buildArkGenerationRequest(brief, exactShot, [image], new Map());
    expect(request.content).toHaveLength(1);
    expect(request.content[0]).toEqual(expect.objectContaining({ text: expect.stringContaining("后期叠加") }));
  });

  it("edits the existing video with AI reference materials", () => {
    const editShot = structuredClone(shot);
    editShot.materialBindings![0].role = "replacement";
    const request = buildArkVideoEditRequest(
      brief,
      editShot,
      [image],
      new Map([[image.id, "https://cdn.example.com/device.png"]]),
      "https://cdn.example.com/original-shot.mp4"
    );
    expect(request.content[0]).toEqual(expect.objectContaining({ type: "text", text: expect.stringContaining("@图片1") }));
    expect(request.content[1]).toEqual({ type: "image_url", image_url: { url: "https://cdn.example.com/device.png" } });
    expect(request.content[2]).toEqual({
      type: "video_url",
      video_url: { url: "https://cdn.example.com/original-shot.mp4" },
      role: "reference_video"
    });
  });
});
