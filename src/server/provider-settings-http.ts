import type express from "express";
import { z } from "zod";
import type { LanAuth, LanSession } from "./auth.js";
import { lanSessionCookie, readCookie } from "./auth.js";
import type { ProviderSettingsStore } from "./provider-settings.js";
import { resolveProviderConfig } from "./provider-settings.js";
import { validatePersonalProviderBaseUrl } from "./provider-url-policy.js";

const secretUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("keep") }),
  z.object({ action: z.literal("replace"), value: z.string().trim().min(8).max(500) })
]);

const httpUrlSchema = z.string().url().max(500);

const scriptSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("server") }),
  z.object({
    mode: z.enum(["deepseek", "openai"]),
    apiKey: secretUpdateSchema,
    baseUrl: httpUrlSchema.optional(),
    model: z.string().trim().min(1).max(120)
  }),
  z.object({
    mode: z.literal("ark"),
    apiKey: secretUpdateSchema,
    model: z.string().trim().min(1).max(120)
  })
]);

const videoSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("server") }),
  z.object({
    mode: z.literal("ark"),
    apiKey: secretUpdateSchema,
    model: z.string().trim().min(1).max(120),
    maxGeneratedShots: z.number().int().min(1).max(6)
  })
]);

const providerSettingsSchema = z.object({ script: scriptSchema, video: videoSchema });

export function authSessionForRequest(request: express.Request, auth: LanAuth): LanSession | undefined {
  const token = readCookie(request.headers.cookie, lanSessionCookie);
  return auth.readSession(token);
}

export function registerProviderSettingsRoutes(
  app: express.Express,
  auth: LanAuth,
  store: ProviderSettingsStore,
  environment: NodeJS.ProcessEnv = process.env
): void {
  const sessionFor = (request: express.Request, response: express.Response): LanSession | undefined => {
    response.setHeader("Cache-Control", "no-store");
    if (!auth.enabled) {
      response.status(409).json({ message: "启用局域网访问口令后才能使用个人 API 设置" });
      return undefined;
    }
    const session = authSessionForRequest(request, auth);
    if (!session) response.status(401).json({ message: "登录已过期，请重新登录" });
    return session;
  };

  app.get("/api/settings/providers", (request, response) => {
    const session = sessionFor(request, response);
    if (!session) return;
    return response.json(resolveProviderConfig(store.get(session.id), environment).view);
  });

  app.put("/api/settings/providers", (request, response) => {
    const session = sessionFor(request, response);
    if (!session) return;
    const parsed = providerSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ message: "API 设置格式不正确", issues: parsed.error.issues });
    }
    try {
      if (parsed.data.script.mode === "openai" || parsed.data.script.mode === "deepseek") {
        if (parsed.data.script.baseUrl) {
          parsed.data.script.baseUrl = validatePersonalProviderBaseUrl(parsed.data.script.baseUrl, environment);
        }
      }
      store.replace(session, parsed.data);
      return response.json(resolveProviderConfig(store.get(session.id), environment).view);
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith("Invalid personal API base URL")
        ? "个人 API 地址必须使用管理员允许的公网 HTTPS 域名"
        : "首次配置或切换服务商时必须输入新的 API Key";
      return response.status(400).json({ message });
    }
  });

  app.delete("/api/settings/providers", (request, response) => {
    const session = sessionFor(request, response);
    if (!session) return;
    store.clear(session.id);
    return response.json(resolveProviderConfig(undefined, environment).view);
  });
}
