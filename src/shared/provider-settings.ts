export type ProviderSecretUpdate =
  | { action: "keep" }
  | { action: "replace"; value: string };

export type ScriptSettingsInput =
  | { mode: "server" }
  | {
    mode: "deepseek" | "openai" | "ark";
    apiKey: ProviderSecretUpdate;
    baseUrl?: string;
    model: string;
  };

export type VideoSettingsInput =
  | { mode: "server" }
  | {
    mode: "ark";
    apiKey: ProviderSecretUpdate;
    model: string;
    maxGeneratedShots: number;
  };

export interface ProviderSettingsInput {
  script: ScriptSettingsInput;
  video: VideoSettingsInput;
}

export interface ProviderSectionView {
  provider: "openai" | "deepseek" | "ark" | "http" | "local";
  source: "session" | "server" | "local";
  connected: boolean;
  model?: string;
  baseUrl?: string;
  maxGeneratedShots?: number;
  hasSessionKey: boolean;
}

export interface ProviderSettingsView {
  script: ProviderSectionView;
  video: ProviderSectionView;
}
