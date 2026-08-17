import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { createLanAuth } from "./auth.js";
import { registerLanAuthRoutes, requireLanAuth } from "./auth-http.js";

async function withServer<T>(secret: string | undefined, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  const auth = createLanAuth(secret, 60);
  app.use(express.json());
  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  registerLanAuthRoutes(app, auth);
  app.use("/api", requireLanAuth(auth));
  app.get("/api/private", (_request, response) => response.json({ ok: true }));
  app.use("/outputs", requireLanAuth(auth));
  app.get("/outputs/example.mp4", (_request, response) => response.sendStatus(204));

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

describe("LAN authentication HTTP boundary", () => {
  it("keeps health and session public while protecting APIs and media", async () => {
    await withServer("shared-secret", async (baseUrl) => {
      expect((await fetch(`${baseUrl}/api/health`)).status).toBe(200);
      expect(await (await fetch(`${baseUrl}/api/auth/session`)).json()).toEqual({ authRequired: true, authenticated: false });
      expect((await fetch(`${baseUrl}/api/private`)).status).toBe(401);
      expect((await fetch(`${baseUrl}/outputs/example.mp4`)).status).toBe(401);
    });
  });

  it("sets a session cookie after login and clears it on logout", async () => {
    await withServer("shared-secret", async (baseUrl) => {
      const rejected = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong-secret" })
      });
      expect(rejected.status).toBe(401);

      const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "shared-secret" })
      });
      expect(login.status).toBe(200);
      const setCookie = login.headers.get("set-cookie") ?? "";
      expect(setCookie).toContain("science_video_session=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      const cookie = setCookie.split(";", 1)[0];

      expect((await fetch(`${baseUrl}/api/private`, { headers: { Cookie: cookie } })).status).toBe(200);
      expect((await fetch(`${baseUrl}/outputs/example.mp4`, { headers: { Cookie: cookie } })).status).toBe(204);

      const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
      expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    });
  });

  it("allows local development when no shared password is configured", async () => {
    await withServer(undefined, async (baseUrl) => {
      expect(await (await fetch(`${baseUrl}/api/auth/session`)).json()).toEqual({ authRequired: false, authenticated: true });
      expect((await fetch(`${baseUrl}/api/private`)).status).toBe(200);
      expect((await fetch(`${baseUrl}/outputs/example.mp4`)).status).toBe(204);
    });
  });
});
