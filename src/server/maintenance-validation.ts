import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const dataSentinelName = ".science-video-workbench-data";
export const dataSentinelContent = "science-video-workbench-data-v1";

const requiredTables = [
  "jobs",
  "job_events",
  "feedback",
  "data_assets",
  "material_assets",
  "job_revisions"
];

export type DataValidationResult = { ok: true } | {
  ok: false;
  reason: "sentinel" | "directories" | "database" | "integrity" | "schema";
};

export function validateDataDirectory(directory: string): DataValidationResult {
  try {
    const sentinel = fs.readFileSync(path.join(directory, dataSentinelName), "utf8").trim();
    if (sentinel !== dataSentinelContent) return { ok: false, reason: "sentinel" };
  } catch {
    return { ok: false, reason: "sentinel" };
  }

  if (!["outputs", "materials"].every((name) => {
    try {
      return fs.statSync(path.join(directory, name)).isDirectory();
    } catch {
      return false;
    }
  })) return { ok: false, reason: "directories" };

  const databasePath = path.join(directory, "studio.sqlite");
  if (!fs.existsSync(databasePath)) return { ok: false, reason: "database" };

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const integrity = database.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") return { ok: false, reason: "integrity" };
    const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    const tables = new Set(rows.map((row) => row.name));
    if (!requiredTables.every((table) => tables.has(table))) return { ok: false, reason: "schema" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "database" };
  } finally {
    database?.close();
  }
}
