import { describe, expect, it } from "vitest";
import { readRuntimeConfig } from "./runtime-config.js";

describe("production runtime configuration", () => {
  it("rejects a LAN listener without a strong access token", () => {
    expect(() => readRuntimeConfig({ HOST: "0.0.0.0", PORT: "8787" })).toThrow(
      "LAN_ACCESS_TOKEN is required when HOST is not loopback"
    );
    expect(() => readRuntimeConfig({
      HOST: "192.168.1.10",
      PORT: "8787",
      LAN_ACCESS_TOKEN: "too-short"
    })).toThrow("at least 16 characters");
  });

  it("allows unauthenticated loopback development", () => {
    expect(readRuntimeConfig({ HOST: "127.0.0.1", PORT: "8787" })).toMatchObject({
      host: "127.0.0.1",
      port: 8787,
      maxConcurrentRenders: 1,
      trustProxy: false
    });
    expect(readRuntimeConfig({ HOST: "::1" }).host).toBe("::1");
    expect(readRuntimeConfig({ HOST: "localhost" }).host).toBe("localhost");
  });

  it("accepts exactly one trusted reverse proxy", () => {
    expect(readRuntimeConfig({
      HOST: "0.0.0.0",
      PORT: "8787",
      LAN_ACCESS_TOKEN: "a-long-LAN-password",
      TRUST_PROXY: "1"
    }).trustProxy).toBe(1);
    expect(() => readRuntimeConfig({ HOST: "127.0.0.1", TRUST_PROXY: "2" })).toThrow("TRUST_PROXY");
  });

  it("validates ports, concurrency, ffmpeg paths, and provider URLs", () => {
    expect(() => readRuntimeConfig({ HOST: "127.0.0.1", PORT: "0" })).toThrow("PORT");
    expect(() => readRuntimeConfig({ HOST: "127.0.0.1", PORT: "65536" })).toThrow("PORT");
    expect(() => readRuntimeConfig({ HOST: "127.0.0.1", MAX_CONCURRENT_RENDERS: "9" })).toThrow("MAX_CONCURRENT_RENDERS");
    expect(() => readRuntimeConfig({ HOST: "127.0.0.1", FFMPEG_PATH: "bin/ffmpeg" })).toThrow("FFMPEG_PATH");
    expect(() => readRuntimeConfig({ HOST: "127.0.0.1", DEEPSEEK_BASE_URL: "file:///secret" })).toThrow("DEEPSEEK_BASE_URL");
    expect(() => readRuntimeConfig({ HOST: "127.0.0.1", VIDEO_PROVIDER_URL: "ftp://video.example" })).toThrow("VIDEO_PROVIDER_URL");
  });

  it("never includes secret values in validation errors", () => {
    const secret = "visible-secret-value";
    let message = "";
    try {
      readRuntimeConfig({ HOST: "0.0.0.0", LAN_ACCESS_TOKEN: secret.slice(0, 10), ARK_API_KEY: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("LAN_ACCESS_TOKEN");
    expect(message).not.toContain(secret);
    expect(message).not.toContain(secret.slice(0, 10));
  });
});
