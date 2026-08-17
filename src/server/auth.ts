import { createHmac, timingSafeEqual } from "node:crypto";

export const lanSessionCookie = "science_video_session";

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function createLanAuth(secret?: string, lifetimeSeconds = 12 * 60 * 60) {
  const configured = secret?.trim();
  const signature = (expiresAt: string) => createHmac("sha256", configured ?? "disabled").update(expiresAt).digest("base64url");

  return {
    enabled: Boolean(configured),
    lifetimeSeconds,
    authenticate(password: string): boolean {
      return configured ? secureEqual(password, configured) : true;
    },
    createSession(now = Date.now()): string {
      const expiresAt = String(now + lifetimeSeconds * 1000);
      return `${expiresAt}.${signature(expiresAt)}`;
    },
    validateSession(token: string | undefined, now = Date.now()): boolean {
      if (!configured) return true;
      if (!token) return false;
      const [expiresAt, suppliedSignature, extra] = token.split(".");
      if (!expiresAt || !suppliedSignature || extra || Number(expiresAt) <= now) return false;
      return secureEqual(suppliedSignature, signature(expiresAt));
    }
  };
}

export type LanAuth = ReturnType<typeof createLanAuth>;
