import type { JobStatus } from "../shared/video.js";

const activeStatuses = new Set<JobStatus>([
  "queued",
  "planning",
  "narrating",
  "rendering",
  "quality_check"
]);

export interface MaintenanceState {
  idle: boolean;
  activeJobs: number;
}

export function summarizeMaintenanceState(jobs: Array<{ status: JobStatus }>): MaintenanceState {
  const activeJobs = jobs.reduce((count, job) => count + (activeStatuses.has(job.status) ? 1 : 0), 0);
  return { idle: activeJobs === 0, activeJobs };
}
