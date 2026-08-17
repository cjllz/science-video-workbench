import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DataAsset, FeedbackInput, MaterialAsset, VideoBrief, VideoJob, VideoPlan, VideoRevision } from "../shared/video.js";
import { dataRoot, databasePath } from "./paths.js";

fs.mkdirSync(dataRoot, { recursive: true });

const db = new DatabaseSync(databasePath);
const initializationTimeoutMs = 5_000;
const sqliteBusyErrorCode = 5;
const retryWait = new Int32Array(new SharedArrayBuffer(4));

const initializationDeadline = Date.now() + initializationTimeoutMs;
// SQLite can skip its busy handler to avoid lock-promotion deadlocks, so retry this idempotent batch.
while (true) {
  const remainingTime = initializationDeadline - Date.now();
  if (remainingTime <= 0) throw new Error("Timed out initializing the database");
  db.exec(`PRAGMA busy_timeout = ${remainingTime};`);
  try {
    db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    brief_json TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    current_stage TEXT NOT NULL,
    plan_json TEXT,
    output_url TEXT,
    poster_url TEXT,
    subtitle_url TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    accepted INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS data_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    columns_json TEXT NOT NULL,
    rows_json TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    numeric_columns_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS material_assets (
    id TEXT PRIMARY KEY,
    variable_name TEXT NOT NULL,
    asset_json TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS job_revisions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    revision_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_job_id ON feedback(job_id);
  CREATE INDEX IF NOT EXISTS idx_material_assets_created_at ON material_assets(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_job_revisions_job_id ON job_revisions(job_id, created_at DESC);
`);
    break;
  } catch (error) {
    const sqliteErrorCode = typeof error === "object" && error !== null && "errcode" in error
      ? error.errcode
      : undefined;
    if (sqliteErrorCode !== sqliteBusyErrorCode) throw error;
    const retryDelay = Math.min(10 + (process.pid % 20), initializationDeadline - Date.now());
    if (retryDelay <= 0) throw error;
    Atomics.wait(retryWait, 0, 0, retryDelay);
    if (Date.now() >= initializationDeadline) throw error;
  }
}

type JobRow = {
  id: string;
  brief_json: string;
  status: VideoJob["status"];
  progress: number;
  current_stage: string;
  plan_json: string | null;
  output_url: string | null;
  poster_url: string | null;
  subtitle_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

function rowToJob(row: JobRow): VideoJob {
  return {
    id: row.id,
    brief: JSON.parse(row.brief_json) as VideoBrief,
    status: row.status,
    progress: row.progress,
    currentStage: row.current_stage,
    plan: row.plan_json ? (JSON.parse(row.plan_json) as VideoPlan) : undefined,
    outputUrl: row.output_url ?? undefined,
    posterUrl: row.poster_url ?? undefined,
    subtitleUrl: row.subtitle_url ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createJob(job: VideoJob): void {
  db.prepare(`
    INSERT INTO jobs (id, brief_json, status, progress, current_stage, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(job.id, JSON.stringify(job.brief), job.status, job.progress, job.currentStage, job.createdAt, job.updatedAt);
  recordEvent(job.id, "job.created", { brief: job.brief });
}

export function updateJob(id: string, patch: Partial<VideoJob>): VideoJob {
  const current = getJob(id);
  if (!current) throw new Error(`Job ${id} not found`);
  const next: VideoJob = { ...current, ...patch, updatedAt: new Date().toISOString() };
  db.prepare(`
    UPDATE jobs SET status = ?, progress = ?, current_stage = ?, plan_json = ?, output_url = ?,
      poster_url = ?, subtitle_url = ?, error = ?, updated_at = ? WHERE id = ?
  `).run(
    next.status,
    next.progress,
    next.currentStage,
    next.plan ? JSON.stringify(next.plan) : null,
    next.outputUrl ?? null,
    next.posterUrl ?? null,
    next.subtitleUrl ?? null,
    next.error ?? null,
    next.updatedAt,
    id
  );
  recordEvent(id, "job.updated", patch);
  return next;
}

export function getJob(id: string): VideoJob | undefined {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? rowToJob(row) : undefined;
}

export function listJobs(limit = 20): VideoJob[] {
  const rows = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?").all(limit) as JobRow[];
  return rows.map(rowToJob);
}

export function recordEvent(jobId: string, eventType: string, payload: unknown): void {
  db.prepare("INSERT INTO job_events (job_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?)")
    .run(jobId, eventType, JSON.stringify(payload), new Date().toISOString());
}

export function addFeedback(jobId: string, feedback: FeedbackInput): void {
  db.prepare("INSERT INTO feedback (job_id, accepted, rating, notes, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(jobId, feedback.accepted ? 1 : 0, feedback.rating, feedback.notes ?? null, new Date().toISOString());
  recordEvent(jobId, "feedback.added", feedback);
}

export interface ExperienceMatch {
  jobId: string;
  score: number;
  plan: VideoPlan;
}

export function findExperience(brief: VideoBrief): ExperienceMatch | undefined {
  const rows = db.prepare(`
    SELECT j.id, j.brief_json, j.plan_json, f.rating
    FROM feedback f JOIN jobs j ON j.id = f.job_id
    WHERE f.accepted = 1 AND j.plan_json IS NOT NULL
    ORDER BY f.rating DESC, f.created_at DESC LIMIT 100
  `).all() as Array<{ id: string; brief_json: string; plan_json: string; rating: number }>;

  const requested = new Set([brief.topic, ...brief.keywords].flatMap((value) => value.toLowerCase().split(/[\s,，、]+/)).filter(Boolean));
  let best: ExperienceMatch | undefined;
  for (const row of rows) {
    const previous = JSON.parse(row.brief_json) as VideoBrief;
    const previousTerms = new Set([previous.topic, ...previous.keywords].flatMap((value) => value.toLowerCase().split(/[\s,，、]+/)).filter(Boolean));
    let score = previous.style === brief.style ? 3 : 0;
    for (const term of requested) if (previousTerms.has(term)) score += 2;
    score += row.rating / 5;
    if (!best || score > best.score) best = { jobId: row.id, score, plan: JSON.parse(row.plan_json) as VideoPlan };
  }
  return best && best.score >= 3 ? best : undefined;
}

export function getLearningStats(): { completed: number; accepted: number; averageRating: number } {
  const completed = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status = 'complete'").get() as { count: number };
  const feedback = db.prepare("SELECT COUNT(*) AS count, COALESCE(AVG(rating), 0) AS average FROM feedback WHERE accepted = 1").get() as { count: number; average: number };
  return { completed: completed.count, accepted: feedback.count, averageRating: Number(feedback.average.toFixed(1)) };
}

type DataAssetRow = {
  id: string;
  name: string;
  columns_json: string;
  rows_json: string;
  row_count: number;
  numeric_columns_json: string;
  summary: string;
  created_at: string;
};

function rowToDataAsset(row: DataAssetRow): DataAsset {
  return {
    id: row.id,
    name: row.name,
    columns: JSON.parse(row.columns_json) as string[],
    rows: JSON.parse(row.rows_json) as DataAsset["rows"],
    rowCount: row.row_count,
    numericColumns: JSON.parse(row.numeric_columns_json) as string[],
    summary: row.summary,
    createdAt: row.created_at
  };
}

export function createDataAsset(asset: DataAsset): void {
  db.prepare(`
    INSERT INTO data_assets (id, name, columns_json, rows_json, row_count, numeric_columns_json, summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    asset.id,
    asset.name,
    JSON.stringify(asset.columns),
    JSON.stringify(asset.rows),
    asset.rowCount,
    JSON.stringify(asset.numericColumns),
    asset.summary,
    asset.createdAt
  );
}

export function getDataAsset(id: string): DataAsset | undefined {
  const row = db.prepare("SELECT * FROM data_assets WHERE id = ?").get(id) as DataAssetRow | undefined;
  return row ? rowToDataAsset(row) : undefined;
}

export function getDataAssets(ids: string[]): DataAsset[] {
  return ids.map(getDataAsset).filter((asset): asset is DataAsset => Boolean(asset));
}

type MaterialAssetRow = {
  id: string;
  variable_name: string;
  asset_json: string;
  storage_path: string;
  created_at: string;
};

export function createMaterialAsset(asset: MaterialAsset, storagePath: string): void {
  db.prepare(`
    INSERT INTO material_assets (id, variable_name, asset_json, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(asset.id, asset.variableName, JSON.stringify(asset), storagePath, asset.createdAt);
}

export function getMaterialAsset(id: string): MaterialAsset | undefined {
  const row = db.prepare("SELECT * FROM material_assets WHERE id = ?").get(id) as MaterialAssetRow | undefined;
  return row ? JSON.parse(row.asset_json) as MaterialAsset : undefined;
}

export function getMaterialAssets(ids: string[]): MaterialAsset[] {
  return ids.map(getMaterialAsset).filter((asset): asset is MaterialAsset => Boolean(asset));
}

export function getMaterialStoragePath(id: string): string | undefined {
  const row = db.prepare("SELECT storage_path FROM material_assets WHERE id = ?").get(id) as Pick<MaterialAssetRow, "storage_path"> | undefined;
  return row?.storage_path;
}

export function listMaterialAssets(limit = 100): MaterialAsset[] {
  const rows = db.prepare("SELECT asset_json FROM material_assets ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Pick<MaterialAssetRow, "asset_json">>;
  return rows.map((row) => JSON.parse(row.asset_json) as MaterialAsset);
}

export function updateMaterialVariable(id: string, variableName: string): MaterialAsset {
  const current = getMaterialAsset(id);
  if (!current) throw new Error(`Material ${id} not found`);
  const next = { ...current, variableName };
  db.prepare("UPDATE material_assets SET variable_name = ?, asset_json = ? WHERE id = ?")
    .run(variableName, JSON.stringify(next), id);
  return next;
}

export function deleteMaterialAsset(id: string): string | undefined {
  const storagePath = getMaterialStoragePath(id);
  db.prepare("DELETE FROM material_assets WHERE id = ?").run(id);
  return storagePath;
}

export function createJobRevision(revision: VideoRevision): void {
  db.prepare("INSERT INTO job_revisions (id, job_id, revision_json, created_at) VALUES (?, ?, ?, ?)")
    .run(revision.id, revision.jobId, JSON.stringify(revision), revision.createdAt);
}

export function listJobRevisions(jobId: string): VideoRevision[] {
  const rows = db.prepare("SELECT revision_json FROM job_revisions WHERE job_id = ? ORDER BY created_at DESC").all(jobId) as Array<{ revision_json: string }>;
  return rows.map((row) => JSON.parse(row.revision_json) as VideoRevision);
}

export function getJobRevision(id: string): VideoRevision | undefined {
  const row = db.prepare("SELECT revision_json FROM job_revisions WHERE id = ?").get(id) as { revision_json: string } | undefined;
  return row ? JSON.parse(row.revision_json) as VideoRevision : undefined;
}

export function deleteJobRevision(id: string): void {
  db.prepare("DELETE FROM job_revisions WHERE id = ?").run(id);
}
