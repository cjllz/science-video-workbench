import { describe, expect, it } from "vitest";
import { resolveFfmpegPath } from "./tooling.js";

describe("ffmpeg resolution", () => {
  it("prefers a validated explicit ffmpeg path", () => {
    expect(resolveFfmpegPath({
      configuredPath: "/usr/bin/ffmpeg",
      bundledPath: "/bundle/ffmpeg",
      exists: () => true
    })).toBe("/usr/bin/ffmpeg");
  });

  it("falls back to a bundled binary for local development", () => {
    expect(resolveFfmpegPath({
      bundledPath: "C:\\tools\\ffmpeg.exe",
      exists: () => true
    })).toBe("C:\\tools\\ffmpeg.exe");
  });

  it("does not hide an invalid explicit configuration", () => {
    expect(() => resolveFfmpegPath({
      configuredPath: "/missing/ffmpeg",
      bundledPath: "/bundle/ffmpeg",
      exists: (candidate) => candidate === "/bundle/ffmpeg"
    })).toThrow("configured ffmpeg executable is unavailable");
  });

  it("fails clearly when neither binary exists", () => {
    expect(() => resolveFfmpegPath({ exists: () => false })).toThrow("ffmpeg executable is unavailable");
  });
});
