import type {
  ProviderSectionView,
  ProviderSecretUpdate,
  ScriptSettingsInput,
  VideoSettingsInput
} from "../shared/provider-settings";

export interface ScriptSettingsForm {
  mode: "server" | "deepseek" | "openai" | "ark";
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface VideoSettingsForm {
  mode: "server" | "ark";
  apiKey: string;
  model: string;
  maxGeneratedShots: number;
}

type ExistingSecret = Pick<ProviderSectionView, "provider" | "hasSessionKey">;

function secretUpdate(
  value: string,
  provider: string,
  existing: ExistingSecret,
  missingMessage: string,
  changedMessage: string
): ProviderSecretUpdate {
  const trimmed = value.trim();
  if (trimmed) return { action: "replace", value: trimmed };
  if (existing.hasSessionKey && existing.provider === provider) return { action: "keep" };
  if (existing.hasSessionKey && existing.provider !== provider) throw new Error(changedMessage);
  throw new Error(missingMessage);
}

export function buildScriptSettingsInput(
  form: ScriptSettingsForm,
  existing: ExistingSecret
): ScriptSettingsInput {
  if (form.mode === "server") return { mode: "server" };
  const apiKey = secretUpdate(
    form.apiKey,
    form.mode,
    existing,
    "请输入脚本 API Key",
    "切换脚本服务后请输入新的 API Key"
  );
  return {
    mode: form.mode,
    apiKey,
    model: form.model.trim(),
    ...(form.mode !== "ark" && form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {})
  };
}

export function buildVideoSettingsInput(
  form: VideoSettingsForm,
  existing: ExistingSecret
): VideoSettingsInput {
  if (form.mode === "server") return { mode: "server" };
  return {
    mode: "ark",
    apiKey: secretUpdate(
      form.apiKey,
      "ark",
      existing,
      "请输入 Seedance API Key",
      "切换视频服务后请输入新的 API Key"
    ),
    model: form.model.trim(),
    maxGeneratedShots: form.maxGeneratedShots
  };
}
