import { constants, accessSync } from "node:fs";
import { createRequire } from "node:module";

export interface FfmpegResolutionOptions {
  configuredPath?: string;
  bundledPath?: string | null;
  exists: (candidate: string) => boolean;
}

export function resolveFfmpegPath(options: FfmpegResolutionOptions): string {
  if (options.configuredPath) {
    if (options.exists(options.configuredPath)) return options.configuredPath;
    throw new Error("configured ffmpeg executable is unavailable");
  }
  if (options.bundledPath && options.exists(options.bundledPath)) return options.bundledPath;
  throw new Error("ffmpeg executable is unavailable");
}

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function optionalBundledFfmpeg(): string | undefined {
  try {
    const bundled = createRequire(import.meta.url)("ffmpeg-static") as unknown;
    return typeof bundled === "string" ? bundled : undefined;
  } catch {
    return undefined;
  }
}

export function getFfmpegPath(environment: NodeJS.ProcessEnv = process.env): string {
  return resolveFfmpegPath({
    configuredPath: environment.FFMPEG_PATH?.trim() || undefined,
    bundledPath: optionalBundledFfmpeg(),
    exists: isExecutable
  });
}
