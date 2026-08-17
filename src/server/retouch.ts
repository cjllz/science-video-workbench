import type { RetouchVisualAction, ShotRetouchInput, VideoJob, VideoPlan } from "../shared/video.js";

export function normalizeRetouchVisualAction(input: ShotRetouchInput): RetouchVisualAction {
  return input.visualAction ?? (input.regenerateVisual ? "regenerate" : "none");
}

export function assertVideoEditSource(action: RetouchVisualAction, sourceUrl: string | undefined): void {
  if (action === "edit" && !sourceUrl) {
    throw new Error("原镜头没有 Seedance 可访问的公网地址，请先完全重做该镜头，或配置 OUTPUT_PUBLIC_BASE_URL");
  }
}

export function assertRetouchable(job: VideoJob): void {
  if (job.status !== "complete") throw new Error("只有已完成的视频可以进行镜头微调");
  if (!job.plan) throw new Error("任务没有可微调的剧本");
  if (!job.outputUrl) throw new Error("任务没有可微调的成片");
}

function validateIntervals(input: ShotRetouchInput, duration: number): void {
  for (const binding of input.patch.materialBindings ?? []) {
    const start = binding.startOffset ?? 0;
    const end = binding.endOffset ?? duration;
    if (start < 0 || end > duration || start >= end) {
      throw new Error(`素材出现区间必须位于 0-${duration} 秒且开始时间早于结束时间`);
    }
  }
}

export function applyShotRetouch(job: VideoJob, input: ShotRetouchInput): VideoPlan {
  assertRetouchable(job);
  const target = job.plan!.shots.find((shot) => shot.id === input.shotId);
  if (!target) throw new Error("要微调的镜头不存在");
  validateIntervals(input, target.duration);

  const shots = job.plan!.shots.map((shot) => shot.id === input.shotId
    ? { ...shot, ...input.patch, status: "pending" as const }
    : { ...shot });
  return { ...job.plan!, shots, script: shots.map((shot) => shot.narration).join("") };
}
