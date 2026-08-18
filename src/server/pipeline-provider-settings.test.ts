import { describe, expect, it } from "vitest";
import type { OperationProviderConfig } from "./provider-settings.js";
import { redactProviderError } from "./provider-settings.js";
import { captureOperationProviderConfig } from "./pipeline.js";

function resolvedConfig(apiKey: string): OperationProviderConfig {
  return {
    planner: {
      provider: "deepseek",
      apiKey,
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      supportsJsonMode: true,
      disableThinking: false
    },
    video: { provider: "ark", apiKey, model: "seedance-test", maxGeneratedShots: 2 },
    view: {
      script: { provider: "deepseek", source: "session", connected: true, model: "deepseek-chat", hasSessionKey: true },
      video: { provider: "ark", source: "session", connected: true, model: "seedance-test", maxGeneratedShots: 2, hasSessionKey: true }
    },
    secrets: [apiKey]
  };
}

describe("operation provider snapshots", () => {
  it("uses the configuration captured when work is enqueued", () => {
    const first = resolvedConfig("first-key");
    const captured = captureOperationProviderConfig(first);
    if (first.video.provider !== "ark" || captured.video.provider !== "ark") {
      throw new Error("expected Ark test configuration");
    }

    first.video.apiKey = "second-key";
    first.secrets[0] = "second-key";
    first.view.video.model = "changed-model";

    expect(captured.video.apiKey).toBe("first-key");
    expect(captured.secrets).toEqual(["first-key"]);
    expect(captured.view.video.model).toBe("seedance-test");
  });

  it("redacts errors with the captured secret list", () => {
    const captured = captureOperationProviderConfig(resolvedConfig("first-key"));
    const message = redactProviderError(new Error("failed first-key"), captured.secrets);
    expect(message).toContain("[redacted]");
    expect(message).not.toContain("first-key");
  });
});
