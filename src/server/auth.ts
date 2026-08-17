import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const lanSessionCookie = "science_video_session";

export interface LanSession {
  id: string;
  expiresAt: number;
}

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
  const signature = (id: string, expiresAt: string) =>
    createHmac("sha256", configured ?? "disabled").update(`${id}.${expiresAt}`).digest("base64url");
  const readSession = (token: string | undefined, now = Date.now()): LanSession | undefined => {
    if (!configured || !token) return undefined;

    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const [id, expiresAtText, suppliedSignature] = parts;
    if (!/^[A-Za-z0-9_-]{20,}$/.test(id) || !/^\d+$/.test(expiresAtText) || !suppliedSignature) return undefined;

    const expiresAt = Number(expiresAtText);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return undefined;
    if (!secureEqual(suppliedSignature, signature(id, expiresAtText))) return undefined;
    return { id, expiresAt };
  };

  return {
    enabled: Boolean(configured),
    lifetimeSeconds,
    authenticate(password: string): boolean {
      return configured ? secureEqual(password, configured) : true;
    },
    createSession(now = Date.now()): string {
      const id = randomBytes(18).toString("base64url");
      const expiresAt = String(now + lifetimeSeconds * 1000);
      return `${id}.${expiresAt}.${signature(id, expiresAt)}`;
    },
    readSession,
    validateSession(token: string | undefined, now = Date.now()): boolean {
      if (!configured) return true;
      return Boolean(readSession(token, now));
    }
  };
}

export type LanAuth = ReturnType<typeof createLanAuth>;
