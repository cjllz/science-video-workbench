import type { LanSession } from "./auth.js";
import type {
  ProviderSecretUpdate,
  ProviderSettingsInput,
  ProviderSettingsView,
  ScriptSettingsInput,
  VideoSettingsInput
} from "../shared/provider-settings.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEEPSEEK_MODEL = "deepseek-chat";
const ARK_TEXT_MODEL = "doubao-seed-2-1-pro-260628";
const ARK_VIDEO_MODEL = "doubao-seedance-2-0-mini-260615";

export interface PlannerConfig {
  provider: "openai" | "deepseek" | "ark";
  apiKey: string;
  baseUrl: string;
  model: string;
  supportsJsonMode: boolean;
  disableThinking: boolean;
}

export type VideoProviderConfig =
  | { provider: "ark"; apiKey: string; model: string; maxGeneratedShots: number }
  | { provider: "http"; endpoint: string; apiKey?: string; maxGeneratedShots: number }
  | { provider: "local"; maxGeneratedShots: 0 };

export interface OperationProviderConfig {
  planner?: PlannerConfig;
  video: VideoProviderConfig;
  view: ProviderSettingsView;
  secrets: string[];
}

interface StoredScriptSettings {
  provider: "openai" | "deepseek" | "ark";
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface StoredVideoSettings {
  provider: "ark";
  apiKey: string;
  model: string;
  maxGeneratedShots: number;
}

export interface StoredProviderSettings {
  script?: StoredScriptSettings;
  video?: StoredVideoSettings;
}

interface StoredRecord extends StoredProviderSettings {
  expiresAt: number;
}

export interface ProviderSettingsStore {
  get(sessionId: string, now?: number): StoredProviderSettings | undefined;
  replace(session: LanSession, input: ProviderSettingsInput, now?: number): StoredProviderSettings | undefined;
  clear(sessionId: string): void;
}

function cloneSettings(settings: StoredProviderSettings): StoredProviderSettings {
  return {
    ...(settings.script ? { script: { ...settings.script } } : {}),
    ...(settings.video ? { video: { ...settings.video } } : {})
  };
}

function resolveSecret(
  update: ProviderSecretUpdate,
  current: { provider: string; apiKey: string } | undefined,
  provider: string
): string {
  if (update.action === "replace") return update.value;
  if (current?.provider === provider) return current.apiKey;
  throw new Error("A new API key is required when configuring or changing providers");
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function replaceScript(
  input: ScriptSettingsInput,
  current: StoredScriptSettings | undefined
): StoredScriptSettings | undefined {
  if (input.mode === "server") return undefined;
  const apiKey = resolveSecret(input.apiKey, current, input.mode);
  const baseUrl = input.mode === "ark"
    ? ARK_BASE_URL
    : normalizeBaseUrl(input.baseUrl ?? (input.mode === "openai" ? OPENAI_BASE_URL : DEEPSEEK_BASE_URL));
  return { provider: input.mode, apiKey, baseUrl, model: input.model };
}

function replaceVideo(
  input: VideoSettingsInput,
  current: StoredVideoSettings | undefined
): StoredVideoSettings | undefined {
  if (input.mode === "server") return undefined;
  return {
    provider: "ark",
    apiKey: resolveSecret(input.apiKey, current, "ark"),
    model: input.model,
    maxGeneratedShots: input.maxGeneratedShots
  };
}

export function createProviderSettingsStore(): ProviderSettingsStore {
  const records = new Map<string, StoredRecord>();

  const prune = (now: number) => {
    for (const [sessionId, record] of records) {
      if (record.expiresAt <= now) records.delete(sessionId);
    }
  };

  return {
    get(sessionId, now = Date.now()) {
      prune(now);
      const record = records.get(sessionId);
      return record ? cloneSettings(record) : undefined;
    },
    replace(session, input, now = Date.now()) {
      prune(now);
      const current = records.get(session.id);
      const next: StoredProviderSettings = {
        script: replaceScript(input.script, current?.script),
        video: replaceVideo(input.video, current?.video)
      };
      if (!next.script && !next.video) {
        records.delete(session.id);
        return undefined;
      }
      records.set(session.id, { ...cloneSettings(next), expiresAt: session.expiresAt });
      return cloneSettings(next);
    },
    clear(sessionId) {
      records.delete(sessionId);
    }
  };
}

function generatedShotLimit(environment: NodeJS.ProcessEnv): number {
  const configured = Number(environment.ARK_MAX_GENERATED_SHOTS ?? 3);
  return Number.isFinite(configured) ? Math.max(1, Math.min(6, Math.trunc(configured))) : 3;
}

function serverPlanner(environment: NodeJS.ProcessEnv): PlannerConfig | undefined {
  if (environment.OPENAI_API_KEY && environment.OPENAI_MODEL) {
    return {
      provider: "openai",
      apiKey: environment.OPENAI_API_KEY,
      baseUrl: normalizeBaseUrl(environment.OPENAI_BASE_URL || OPENAI_BASE_URL),
      model: environment.OPENAI_MODEL,
      supportsJsonMode: true,
      disableThinking: false
    };
  }
  if (environment.DEEPSEEK_API_KEY) {
    return {
      provider: "deepseek",
      apiKey: environment.DEEPSEEK_API_KEY,
      baseUrl: normalizeBaseUrl(environment.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL),
      model: environment.DEEPSEEK_MODEL || DEEPSEEK_MODEL,
      supportsJsonMode: true,
      disableThinking: false
    };
  }
  if (environment.ARK_API_KEY) {
    return {
      provider: "ark",
      apiKey: environment.ARK_API_KEY,
      baseUrl: ARK_BASE_URL,
      model: environment.ARK_TEXT_MODEL || ARK_TEXT_MODEL,
      supportsJsonMode: false,
      disableThinking: true
    };
  }
  return undefined;
}

function sessionPlanner(settings: StoredScriptSettings): PlannerConfig {
  return {
    ...settings,
    supportsJsonMode: settings.provider !== "ark",
    disableThinking: settings.provider === "ark"
  };
}

function serverVideo(environment: NodeJS.ProcessEnv): VideoProviderConfig {
  const maxGeneratedShots = generatedShotLimit(environment);
  if (environment.ARK_API_KEY) {
    return {
      provider: "ark",
      apiKey: environment.ARK_API_KEY,
      model: environment.ARK_VIDEO_MODEL || ARK_VIDEO_MODEL,
      maxGeneratedShots
    };
  }
  if (environment.VIDEO_PROVIDER_URL) {
    return {
      provider: "http",
      endpoint: environment.VIDEO_PROVIDER_URL,
      ...(environment.VIDEO_PROVIDER_API_KEY ? { apiKey: environment.VIDEO_PROVIDER_API_KEY } : {}),
      maxGeneratedShots
    };
  }
  return { provider: "local", maxGeneratedShots: 0 };
}

function settingsView(
  planner: PlannerConfig | undefined,
  video: VideoProviderConfig,
  session: StoredProviderSettings
): ProviderSettingsView {
  return {
    script: planner ? {
      provider: planner.provider,
      source: session.script ? "session" : "server",
      connected: true,
      model: planner.model,
      baseUrl: planner.baseUrl,
      hasSessionKey: Boolean(session.script)
    } : {
      provider: "local",
      source: "local",
      connected: false,
      hasSessionKey: false
    },
    video: video.provider === "local" ? {
      provider: "local",
      source: "local",
      connected: false,
      maxGeneratedShots: 0,
      hasSessionKey: false
    } : {
      provider: video.provider,
      source: session.video ? "session" : "server",
      connected: true,
      ...(video.provider === "ark" ? { model: video.model } : {}),
      maxGeneratedShots: video.maxGeneratedShots,
      hasSessionKey: Boolean(session.video)
    }
  };
}

export function resolveProviderConfig(
  sessionSettings: StoredProviderSettings | undefined,
  environment: NodeJS.ProcessEnv = process.env
): OperationProviderConfig {
  const session = sessionSettings ? cloneSettings(sessionSettings) : {};
  const planner = session.script ? sessionPlanner(session.script) : serverPlanner(environment);
  const video: VideoProviderConfig = session.video
    ? { ...session.video }
    : serverVideo(environment);
  const secrets = [
    planner?.apiKey,
    video.provider === "ark" || video.provider === "http" ? video.apiKey : undefined
  ].filter((secret): secret is string => Boolean(secret));
  return { planner, video, view: settingsView(planner, video, session), secrets: [...new Set(secrets)] };
}

export function redactProviderError(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  const orderedSecrets = [...new Set(secrets.filter(Boolean))].sort((left, right) => right.length - left.length);
  for (const secret of orderedSecrets) message = message.replaceAll(secret, "[redacted]");
  return message;
}
