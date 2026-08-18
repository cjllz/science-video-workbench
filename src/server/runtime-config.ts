import path from "node:path";
import { z } from "zod";
import { personalApiAllowedHosts } from "./provider-url-policy.js";

export interface RuntimeConfig {
  host: string;
  port: number;
  lanAccessToken?: string;
  maxConcurrentRenders: number;
  trustProxy: false | 1;
  ffmpegPath?: string;
}

const integerFromEnvironment = (fallback: number, minimum: number, maximum: number) => z.preprocess(
  (value) => value === undefined || value === "" ? fallback : value,
  z.coerce.number().int().min(minimum).max(maximum)
);

const runtimeSchema = z.object({
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: integerFromEnvironment(8787, 1, 65_535),
  LAN_ACCESS_TOKEN: z.string().trim().optional(),
  MAX_CONCURRENT_RENDERS: integerFromEnvironment(1, 1, 8),
  TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  FFMPEG_PATH: z.string().trim().optional()
});

const urlFields = [
  "OPENAI_BASE_URL",
  "DEEPSEEK_BASE_URL",
  "VIDEO_PROVIDER_URL",
  "MATERIAL_PUBLIC_BASE_URL",
  "OUTPUT_PUBLIC_BASE_URL"
] as const;

const modelFields = ["OPENAI_MODEL", "DEEPSEEK_MODEL", "ARK_TEXT_MODEL", "ARK_VIDEO_MODEL"] as const;

function configurationError(field: string, detail: string): Error {
  return new Error(`Invalid runtime configuration: ${field}: ${detail}`);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function readRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const parsed = runtimeSchema.safeParse(environment);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue?.path[0] ?? "environment");
    throw configurationError(field, issue?.message ?? "invalid value");
  }

  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  const lanAccessToken = parsed.data.LAN_ACCESS_TOKEN || undefined;
  if (!loopbackHosts.has(parsed.data.HOST)) {
    if (!lanAccessToken) {
      throw configurationError("LAN_ACCESS_TOKEN", "LAN_ACCESS_TOKEN is required when HOST is not loopback");
    }
    if (lanAccessToken.length < 16) {
      throw configurationError("LAN_ACCESS_TOKEN", "must be at least 16 characters when HOST is not loopback");
    }
    const knownPlaceholders = new Set([
      "replace-with-a-long-random-password",
      "change-me",
      "changeme"
    ]);
    if (knownPlaceholders.has(lanAccessToken.toLowerCase())) {
      throw configurationError("LAN_ACCESS_TOKEN", "must not use a documented placeholder value");
    }
  }

  const ffmpegPath = parsed.data.FFMPEG_PATH || undefined;
  if (ffmpegPath && !path.isAbsolute(ffmpegPath)) {
    throw configurationError("FFMPEG_PATH", "must be an absolute path");
  }

  for (const field of urlFields) {
    const value = environment[field]?.trim();
    if (value && !isHttpUrl(value)) throw configurationError(field, "must be an HTTP or HTTPS URL");
  }

  for (const field of modelFields) {
    const value = environment[field]?.trim();
    if (value && value.length > 200) throw configurationError(field, "must be at most 200 characters");
  }

  const generatedShots = environment.ARK_MAX_GENERATED_SHOTS?.trim();
  if (generatedShots) {
    const value = Number(generatedShots);
    if (!Number.isInteger(value) || value < 1 || value > 6) {
      throw configurationError("ARK_MAX_GENERATED_SHOTS", "must be an integer from 1 through 6");
    }
  }

  personalApiAllowedHosts(environment);

  return Object.freeze({
    host: parsed.data.HOST,
    port: parsed.data.PORT,
    ...(lanAccessToken ? { lanAccessToken } : {}),
    maxConcurrentRenders: parsed.data.MAX_CONCURRENT_RENDERS,
    trustProxy: parsed.data.TRUST_PROXY === "1" ? 1 : false,
    ...(ffmpegPath ? { ffmpegPath } : {})
  });
}
