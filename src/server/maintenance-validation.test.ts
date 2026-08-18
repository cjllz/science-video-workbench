import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dataSentinelContent, dataSentinelName, validateDataDirectory } from "./maintenance-validation.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "science-video-validation-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("read-only maintenance validation", () => {
  it("rejects an empty directory without creating a database or subdirectories", () => {
    const directory = temporaryDirectory();
    expect(validateDataDirectory(directory)).toEqual({ ok: false, reason: "sentinel" });
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("requires the expected schema and complete directory layout", () => {
    const directory = temporaryDirectory();
    fs.writeFileSync(path.join(directory, dataSentinelName), `${dataSentinelContent}\n`);
    fs.mkdirSync(path.join(directory, "outputs"));
    fs.mkdirSync(path.join(directory, "materials"));
    const database = new DatabaseSync(path.join(directory, "studio.sqlite"));
    for (const table of ["jobs", "job_events", "feedback", "data_assets", "material_assets", "job_revisions"]) {
      database.exec(`CREATE TABLE ${table} (id INTEGER)`);
    }
    database.close();

    expect(validateDataDirectory(directory)).toEqual({ ok: true });
  });
});
