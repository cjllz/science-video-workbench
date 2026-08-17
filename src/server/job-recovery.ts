import type { JobStatus, VideoJob } from "../shared/video.js";
import { listJobs, updateJob } from "./db.js";

const interruptedStatuses = new Set<JobStatus>(["queued", "planning", "narrating", "rendering", "quality_check"]);

export function isInterruptedStatus(status: JobStatus): boolean {
  return interruptedStatuses.has(status);
}

export function interruptedJobPatch(job: VideoJob): Partial<VideoJob> | undefined {
  if (!isInterruptedStatus(job.status)) return undefined;
  return {
    status: "failed",
    progress: 0,
    currentStage: "服务重启，任务已中断",
    error: "任务在服务重启时尚未完成，请点击重试"
  };
}

export function retryPhase(job: VideoJob): "planning" | "rendering" {
  if (job.status !== "failed") throw new Error("只有失败任务可以重试");
  return job.plan ? "rendering" : "planning";
}

export function markInterruptedJobsFailed(): number {
  let recovered = 0;
  for (const job of listJobs(10_000)) {
    const patch = interruptedJobPatch(job);
    if (!patch) continue;
    updateJob(job.id, patch);
    recovered += 1;
  }
  return recovered;
}
