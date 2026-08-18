import type express from "express";
import { lanSessionCookie, readCookie, type LanAuth } from "./auth.js";

export const mutationRequestHeader = "x-science-video-request";

export const requireTrustedMutation: express.RequestHandler = (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  if (request.get(mutationRequestHeader) !== "1") {
    return response.status(403).json({ message: "请求来源校验失败" });
  }

  const origin = request.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.host !== request.get("host") || parsed.protocol !== `${request.protocol}:`) {
        return response.status(403).json({ message: "请求来源校验失败" });
      }
    } catch {
      return response.status(403).json({ message: "请求来源校验失败" });
    }
  }
  return next();
};

function sessionCookie(value: string, maxAge: number, secure = false): string {
  return [
    `${lanSessionCookie}=${value}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    ...(secure ? ["Secure"] : [])
  ].join("; ");
}

export function registerLanAuthRoutes(app: express.Express, auth: LanAuth, onLogout?: (sessionId: string) => void): void {
  app.get("/api/auth/session", (request, response) => {
    const token = readCookie(request.headers.cookie, lanSessionCookie);
    response.setHeader("Cache-Control", "no-store");
    return response.json({ authRequired: auth.enabled, authenticated: auth.validateSession(token) });
  });

  app.post("/api/auth/login", (request, response) => {
    const password = typeof request.body?.password === "string" ? request.body.password : "";
    if (!auth.authenticate(password)) return response.status(401).json({ message: "访问口令不正确" });

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Set-Cookie", sessionCookie(auth.createSession(), auth.lifetimeSeconds, request.secure));
    return response.json({ authenticated: true });
  });

  app.post("/api/auth/logout", (request, response) => {
    const token = readCookie(request.headers.cookie, lanSessionCookie);
    const session = auth.readSession(token);
    if (session) onLogout?.(session.id);

    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Set-Cookie", sessionCookie("", 0));
    return response.json({ ok: true });
  });
}

export function requireLanAuth(auth: LanAuth): express.RequestHandler {
  return (request, response, next) => {
    const token = readCookie(request.headers.cookie, lanSessionCookie);
    if (auth.validateSession(token)) return next();
    return response.status(401).json({ message: "请输入局域网访问口令" });
  };
}
