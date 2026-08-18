import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import type { ProviderSettingsInput } from "../shared/provider-settings.js";
import { createLanAuth } from "./auth.js";
import { mutationRequestHeader, registerLanAuthRoutes, requireLanAuth, requireTrustedMutation } from "./auth-http.js";
import { registerProviderSettingsRoutes } from "./provider-settings-http.js";
import { createProviderSettingsStore } from "./provider-settings.js";

function personalSettings(scriptKey: string, videoKey: string): ProviderSettingsInput {
  return {
    script: {
      mode: "deepseek",
      apiKey: { action: "replace", value: scriptKey },
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat"
    },
    video: {
      mode: "ark",
      apiKey: { action: "replace", value: videoKey },
      model: "seedance-test",
      maxGeneratedShots: 3
    }
  };
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [mutationRequestHeader]: "1" },
    body: JSON.stringify({ password: "shared-secret" })
  });
  expect(response.status).toBe(200);
  return (response.headers.get("set-cookie") ?? "").split(";", 1)[0];
}

async function withSettingsServer<T>(
  secret: string | undefined,
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const app = express();
  const auth = createLanAuth(secret, 60);
  const store = createProviderSettingsStore();
  app.use(express.json());
  app.use("/api", requireTrustedMutation);
  registerLanAuthRoutes(app, auth, store.clear);
  app.use("/api", requireLanAuth(auth));
  registerProviderSettingsRoutes(app, auth, store, {});

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function putSettings(baseUrl: string, cookie: string, input: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/settings/providers`, {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json", [mutationRequestHeader]: "1" },
    body: JSON.stringify(input)
  });
}

describe("provider settings HTTP boundary", () => {
  it("isolates two authenticated sessions and never returns submitted keys", async () => {
    await withSettingsServer("shared-secret", async (baseUrl) => {
      const firstCookie = await login(baseUrl);
      const secondCookie = await login(baseUrl);

      const saved = await putSettings(baseUrl, firstCookie, personalSettings("personal-script-key", "personal-video-key"));
      expect(saved.status).toBe(200);
      const savedText = await saved.text();
      expect(savedText).not.toContain("personal-script-key");
      expect(savedText).not.toContain("personal-video-key");
      expect(JSON.parse(savedText)).toMatchObject({
        script: { source: "session", provider: "deepseek", hasSessionKey: true },
        video: { source: "session", provider: "ark", hasSessionKey: true }
      });

      const secondView = await fetch(`${baseUrl}/api/settings/providers`, { headers: { Cookie: secondCookie } });
      expect(await secondView.json()).toMatchObject({
        script: { source: "local", hasSessionKey: false },
        video: { source: "local", hasSessionKey: false }
      });
    });
  });

  it("supports keep, clear, and logout cleanup", async () => {
    await withSettingsServer("shared-secret", async (baseUrl) => {
      const cookie = await login(baseUrl);
      expect((await putSettings(baseUrl, cookie, personalSettings("personal-script-key", "personal-video-key"))).status).toBe(200);

      const kept = await putSettings(baseUrl, cookie, {
        script: { mode: "deepseek", apiKey: { action: "keep" }, model: "deepseek-next" },
        video: { mode: "ark", apiKey: { action: "keep" }, model: "seedance-next", maxGeneratedShots: 2 }
      });
      expect(kept.status).toBe(200);
      expect(await kept.json()).toMatchObject({
        script: { model: "deepseek-next", source: "session" },
        video: { model: "seedance-next", maxGeneratedShots: 2, source: "session" }
      });

      const cleared = await fetch(`${baseUrl}/api/settings/providers`, {
        method: "DELETE",
        headers: { Cookie: cookie, [mutationRequestHeader]: "1" }
      });
      expect(await cleared.json()).toMatchObject({ script: { source: "local" }, video: { source: "local" } });

      expect((await putSettings(baseUrl, cookie, personalSettings("second-script-key", "second-video-key"))).status).toBe(200);
      expect((await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, [mutationRequestHeader]: "1" } })).status).toBe(200);
      const afterLogout = await fetch(`${baseUrl}/api/settings/providers`, { headers: { Cookie: cookie } });
      expect(await afterLogout.json()).toMatchObject({ script: { source: "local" }, video: { source: "local" } });
    });
  });

  it("rejects missing authentication and disabled-auth personal settings", async () => {
    await withSettingsServer("shared-secret", async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/settings/providers`)).status).toBe(401);
    });
    await withSettingsServer(undefined, async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/settings/providers`)).status).toBe(409);
      expect((await putSettings(baseUrl, "", personalSettings("personal-script-key", "personal-video-key"))).status).toBe(409);
    });
  });

  it("rejects initial keep, provider changes without a key, and invalid fields", async () => {
    await withSettingsServer("shared-secret", async (baseUrl) => {
      const cookie = await login(baseUrl);
      const initialKeep = await putSettings(baseUrl, cookie, {
        ...personalSettings("personal-script-key", "personal-video-key"),
        script: { mode: "deepseek", apiKey: { action: "keep" }, model: "deepseek-chat" }
      });
      expect(initialKeep.status).toBe(400);

      expect((await putSettings(baseUrl, cookie, personalSettings("personal-script-key", "personal-video-key"))).status).toBe(200);
      const changed = await putSettings(baseUrl, cookie, {
        ...personalSettings("personal-script-key", "personal-video-key"),
        script: { mode: "openai", apiKey: { action: "keep" }, model: "gpt-test" }
      });
      expect(changed.status).toBe(400);

      const invalidInputs = [
        { ...personalSettings("personal-script-key", "personal-video-key"), script: { mode: "deepseek", apiKey: { action: "replace", value: "personal-script-key" }, baseUrl: "http://api.deepseek.com/v1", model: "deepseek-chat" } },
        { ...personalSettings("personal-script-key", "personal-video-key"), script: { mode: "deepseek", apiKey: { action: "replace", value: "personal-script-key" }, baseUrl: "https://127.0.0.1/v1", model: "deepseek-chat" } },
        { ...personalSettings("personal-script-key", "personal-video-key"), script: { mode: "deepseek", apiKey: { action: "replace", value: "personal-script-key" }, baseUrl: "https://unlisted.example/v1", model: "deepseek-chat" } },
        { ...personalSettings("personal-script-key", "personal-video-key"), script: { mode: "deepseek", apiKey: { action: "replace", value: "personal-script-key" }, baseUrl: "ftp://example.com", model: "deepseek-chat" } },
        { ...personalSettings("personal-script-key", "personal-video-key"), script: { mode: "deepseek", apiKey: { action: "replace", value: "personal-script-key" }, model: "x".repeat(121) } },
        { ...personalSettings("personal-script-key", "personal-video-key"), video: { mode: "ark", apiKey: { action: "replace", value: "personal-video-key" }, model: "seedance", maxGeneratedShots: 7 } }
      ];
      for (const input of invalidInputs) expect((await putSettings(baseUrl, cookie, input)).status).toBe(400);
    });
  });
});
