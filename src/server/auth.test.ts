import { describe, expect, it } from "vitest";
import { createLanAuth, readCookie } from "./auth.js";

describe("LAN authentication", () => {
  const now = Date.UTC(2026, 7, 17, 8);

  it("accepts the shared password and validates a signed session", () => {
    const auth = createLanAuth("shared-secret", 60);

    expect(auth.authenticate("shared-secret")).toBe(true);
    expect(auth.authenticate("wrong-secret")).toBe(false);

    const token = auth.createSession(now);
    expect(auth.validateSession(token, now + 30_000)).toBe(true);
  });

  it("rejects expired and modified sessions", () => {
    const auth = createLanAuth("shared-secret", 60);
    const token = auth.createSession(now);

    expect(auth.validateSession(token, now + 61_000)).toBe(false);
    expect(auth.validateSession(`${token}x`, now + 1_000)).toBe(false);
  });

  it("disables authentication when no shared password is configured", () => {
    const auth = createLanAuth(undefined);

    expect(auth.enabled).toBe(false);
    expect(auth.validateSession(undefined, now)).toBe(true);
  });

  it("reads a named cookie without decoding unrelated values", () => {
    expect(readCookie("theme=dark; science_video_session=abc.def", "science_video_session")).toBe("abc.def");
    expect(readCookie("theme=dark", "science_video_session")).toBeUndefined();
  });
});
