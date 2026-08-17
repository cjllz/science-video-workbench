import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProviderAssetManifest, saveProviderAssetRecord, selectReferenceVideoUrl } from "./provider-assets.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("provider asset manifest", () => {
  it("persists the editable source for a generated shot", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "provider-assets-"));
    directories.push(directory);
    await saveProviderAssetRecord(directory, {
      shotId: "shot-1",
      index: 0,
      filename: "provider-0.mp4",
      provider: "ark:seedance",
      sourceUrl: "https://ark.example.com/result.mp4",
      sourceExpiresAt: "2026-08-04T00:00:00.000Z",
      createdAt: "2026-08-03T00:00:00.000Z"
    });
    expect(await loadProviderAssetManifest(directory)).toEqual(expect.objectContaining({
      shots: expect.objectContaining({ "shot-1": expect.objectContaining({ filename: "provider-0.mp4" }) })
    }));
  });

  it("uses a live Ark URL, then falls back to the configured public output origin", () => {
    const record = {
      shotId: "shot-1",
      index: 0,
      filename: "provider-0.mp4",
      provider: "ark:seedance",
      sourceUrl: "https://ark.example.com/result.mp4",
      sourceExpiresAt: "2026-08-04T00:00:00.000Z",
      createdAt: "2026-08-03T00:00:00.000Z"
    };
    expect(selectReferenceVideoUrl(record, "job-1", "https://media.example.com", new Date("2026-08-03T12:00:00Z"))).toBe("https://ark.example.com/result.mp4");
    expect(selectReferenceVideoUrl(record, "job-1", "https://media.example.com/", new Date("2026-08-05T00:00:00Z"))).toBe("https://media.example.com/outputs/job-1/provider-0.mp4");
    expect(selectReferenceVideoUrl(record, "job-1", undefined, new Date("2026-08-05T00:00:00Z"))).toBeUndefined();
  });
});
