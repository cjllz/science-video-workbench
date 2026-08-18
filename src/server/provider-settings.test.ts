import { describe, expect, it } from "vitest";
import type { ProviderSettingsInput } from "../shared/provider-settings.js";
import {
  createProviderSettingsStore,
  redactProviderError,
  resolveProviderConfig
} from "./provider-settings.js";

const personalSettings = (scriptKey = "deepseek-a", videoKey = "ark-video-a"): ProviderSettingsInput => ({
  script: {
    mode: "deepseek",
    apiKey: { action: "replace", value: scriptKey },
    baseUrl: "https://api.deepseek.com/v1/",
    model: "deepseek-chat"
  },
  video: {
    mode: "ark",
    apiKey: { action: "replace", value: videoKey },
    model: "seedance-test",
    maxGeneratedShots: 3
  }
});

describe("provider settings store", () => {
  it("isolates settings by session and returns defensive copies", () => {
    const store = createProviderSettingsStore();
    store.replace({ id: "session-a", expiresAt: 2_000 }, personalSettings(), 1_000);

    const first = store.get("session-a", 1_000);
    expect(first?.script?.apiKey).toBe("deepseek-a");
    expect(store.get("session-b", 1_000)).toBeUndefined();

    if (!first?.script) throw new Error("expected script settings");
    first.script.apiKey = "mutated";
    expect(store.get("session-a", 1_000)?.script?.apiKey).toBe("deepseek-a");
  });

  it("keeps existing keys only for the same provider", () => {
    const store = createProviderSettingsStore();
    const session = { id: "session-a", expiresAt: 2_000 };
    store.replace(session, personalSettings(), 1_000);

    store.replace(session, {
      script: {
        mode: "deepseek",
        apiKey: { action: "keep" },
        baseUrl: "https://proxy.example/v1",
        model: "deepseek-reasoner"
      },
      video: {
        mode: "ark",
        apiKey: { action: "keep" },
        model: "seedance-next",
        maxGeneratedShots: 2
      }
    }, 1_100);

    expect(store.get("session-a", 1_100)).toMatchObject({
      script: { apiKey: "deepseek-a", model: "deepseek-reasoner" },
      video: { apiKey: "ark-video-a", model: "seedance-next" }
    });

    expect(() => store.replace(session, {
      ...personalSettings(),
      script: { mode: "openai", apiKey: { action: "keep" }, model: "gpt-test" }
    }, 1_200)).toThrow("new API key");
  });

  it("rejects keep for an initial setting and removes server-mode sections", () => {
    const store = createProviderSettingsStore();
    const session = { id: "session-a", expiresAt: 2_000 };
    expect(() => store.replace(session, {
      ...personalSettings(),
      script: { mode: "deepseek", apiKey: { action: "keep" }, model: "deepseek-chat" }
    }, 1_000)).toThrow("new API key");

    store.replace(session, personalSettings(), 1_000);
    store.replace(session, { script: { mode: "server" }, video: { mode: "server" } }, 1_100);
    expect(store.get("session-a", 1_100)).toBeUndefined();
  });

  it("expires records lazily and can clear one session", () => {
    const store = createProviderSettingsStore();
    store.replace({ id: "expired", expiresAt: 1_100 }, personalSettings("expired-key"), 1_000);
    store.replace({ id: "current", expiresAt: 2_000 }, personalSettings("current-key"), 1_000);

    expect(store.get("expired", 1_101)).toBeUndefined();
    store.clear("current");
    expect(store.get("current", 1_101)).toBeUndefined();
  });
});

describe("provider configuration resolver", () => {
  it("falls back independently to administrator providers", () => {
    const store = createProviderSettingsStore();
    store.replace({ id: "session-a", expiresAt: 2_000 }, {
      ...personalSettings("personal"),
      video: { mode: "server" }
    }, 1_000);

    const resolved = resolveProviderConfig(store.get("session-a", 1_000), {
      ARK_API_KEY: "server-ark",
      ARK_VIDEO_MODEL: "server-video"
    });
    expect(resolved.planner?.apiKey).toBe("personal");
    expect(resolved.video).toMatchObject({ provider: "ark", apiKey: "server-ark", model: "server-video" });
    expect(resolved.view).toMatchObject({
      script: { provider: "deepseek", source: "session", hasSessionKey: true },
      video: { provider: "ark", source: "server", hasSessionKey: false }
    });
    expect(JSON.stringify(resolved.view)).not.toContain("personal");
    expect(JSON.stringify(resolved.view)).not.toContain("server-ark");
  });

  it("preserves server priority and local fallbacks", () => {
    const server = resolveProviderConfig(undefined, {
      OPENAI_API_KEY: "openai-key",
      OPENAI_MODEL: "gpt-test",
      DEEPSEEK_API_KEY: "deepseek-key",
      ARK_API_KEY: "ark-key",
      VIDEO_PROVIDER_URL: "https://video.example/generate",
      ARK_MAX_GENERATED_SHOTS: "99"
    });
    expect(server.planner).toMatchObject({ provider: "openai", model: "gpt-test" });
    expect(server.video).toMatchObject({ provider: "ark", maxGeneratedShots: 6 });

    const local = resolveProviderConfig(undefined, {});
    expect(local.planner).toBeUndefined();
    expect(local.video).toEqual({ provider: "local", maxGeneratedShots: 0 });
    expect(local.view).toMatchObject({
      script: { provider: "local", source: "local", connected: false },
      video: { provider: "local", source: "local", connected: false }
    });
  });

  it("redacts every non-empty operation secret", () => {
    const resolved = resolveProviderConfig(undefined, {
      OPENAI_API_KEY: "openai-secret",
      OPENAI_MODEL: "gpt-test",
      VIDEO_PROVIDER_URL: "https://video.example/generate",
      VIDEO_PROVIDER_API_KEY: "video-secret"
    });
    expect(redactProviderError(
      new Error("openai-secret and video-secret failed"),
      resolved.secrets
    )).toBe("[redacted] and [redacted] failed");
  });
});
