import { describe, expect, it } from "vitest";
import { buildScriptSettingsInput, buildVideoSettingsInput } from "./provider-settings-form";

describe("provider settings form model", () => {
  it("keeps a saved key when its secret input remains blank", () => {
    const result = buildScriptSettingsInput(
      { mode: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "" },
      { provider: "deepseek", hasSessionKey: true }
    );
    expect(result).toMatchObject({ mode: "deepseek", apiKey: { action: "keep" } });
  });

  it("replaces a saved key when a non-blank value is entered", () => {
    const result = buildScriptSettingsInput(
      { mode: "deepseek", model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1", apiKey: "  new-secret-key  " },
      { provider: "deepseek", hasSessionKey: true }
    );
    expect(result).toMatchObject({ apiKey: { action: "replace", value: "new-secret-key" } });
  });

  it("requires replacement after changing script providers", () => {
    expect(() => buildScriptSettingsInput(
      { mode: "openai", model: "gpt-test", baseUrl: "https://api.openai.com/v1", apiKey: "" },
      { provider: "deepseek", hasSessionKey: true }
    )).toThrow("切换脚本服务后请输入新的 API Key");
  });

  it("uses server mode without sending a key", () => {
    expect(buildScriptSettingsInput(
      { mode: "server", model: "ignored", baseUrl: "", apiKey: "must-not-leak" },
      { provider: "deepseek", hasSessionKey: true }
    )).toEqual({ mode: "server" });
    expect(buildVideoSettingsInput(
      { mode: "server", model: "ignored", apiKey: "must-not-leak", maxGeneratedShots: 3 },
      { provider: "ark", hasSessionKey: true }
    )).toEqual({ mode: "server" });
  });

  it("applies the same keep and provider-change rules to video settings", () => {
    expect(buildVideoSettingsInput(
      { mode: "ark", model: "seedance-test", apiKey: "", maxGeneratedShots: 2 },
      { provider: "ark", hasSessionKey: true }
    )).toMatchObject({ apiKey: { action: "keep" }, maxGeneratedShots: 2 });

    expect(() => buildVideoSettingsInput(
      { mode: "ark", model: "seedance-test", apiKey: "", maxGeneratedShots: 2 },
      { provider: "local", hasSessionKey: false }
    )).toThrow("请输入 Seedance API Key");
  });
});
