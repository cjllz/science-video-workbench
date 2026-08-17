import { describe, expect, it } from "vitest";
import { createLanAuth, readCookie } from "./auth.js";

describe("LAN authentication", () => {
  const now = Date.UTC(2026, 7, 17, 8);

  it("creates unique signed session identities that can be read", () => {
    const auth = createLanAuth("shared-secret", 60);

    expect(auth.authenticate("shared-secret")).toBe(true);
    expect(auth.authenticate("wrong-secret")).toBe(false);

    const firstToken = auth.createSession(now);
    const secondToken = auth.createSession(now);
    const firstSession = auth.readSession(firstToken, now + 1_000);
    const secondSession = auth.readSession(secondToken, now + 1_000);

    expect(firstSession).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{20,}$/),
      expiresAt: now + 60_000
    });
    expect(secondSession?.id).not.toBe(firstSession?.id);
    expect(auth.validateSession(firstToken, now + 30_000)).toBe(true);
  });

  it("rejects sessions when the signed identity or expiry is modified", () => {
    const auth = createLanAuth("shared-secret", 60);
    const token = auth.createSession(now);
    const [id, expiresAt, signature] = token.split(".");

    expect(auth.validateSession(token, now + 61_000)).toBe(false);
    expect(auth.readSession(`x${id}.${expiresAt}.${signature}`, now + 1_000)).toBeUndefined();
    expect(auth.readSession(`${id}.${Number(expiresAt) + 1}.${signature}`, now + 1_000)).toBeUndefined();
    expect(auth.readSession(`${id}.${expiresAt}.${signature}x`, now + 1_000)).toBeUndefined();
  });

  it("rejects malformed session tokens", () => {
    const auth = createLanAuth("shared-secret", 60);
    const validId = "a".repeat(24);

    expect(auth.readSession(undefined, now)).toBeUndefined();
    expect(auth.readSession("missing.parts", now)).toBeUndefined();
    expect(auth.readSession("too.many.token.parts", now)).toBeUndefined();
    expect(auth.readSession(`${validId}.not-a-number.signature`, now)).toBeUndefined();
    expect(auth.readSession(`${validId}.Infinity.signature`, now)).toBeUndefined();
  });

  it("disables authentication when no shared password is configured", () => {
    const auth = createLanAuth(undefined);

    expect(auth.enabled).toBe(false);
    expect(auth.validateSession(undefined, now)).toBe(true);
    expect(auth.readSession(auth.createSession(now), now)).toBeUndefined();
  });

  it("reads a named cookie without decoding unrelated values", () => {
    expect(readCookie("theme=dark; science_video_session=abc.def", "science_video_session")).toBe("abc.def");
    expect(readCookie("theme=dark", "science_video_session")).toBeUndefined();
  });
});
