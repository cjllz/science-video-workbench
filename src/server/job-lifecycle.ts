import type { VideoJob } from "../shared/video.js";

export function assertPlanEditable(job: VideoJob): void {
  if (job.status !== "awaiting_confirmation") throw new Error("只有待确认的剧本可以编辑");
}

export function assertRenderable(job: VideoJob): void {
  if (job.status !== "awaiting_confirmation") throw new Error("请先完成并确认剧本");
  if (!job.plan) throw new Error("任务还没有可生成的剧本");
}
