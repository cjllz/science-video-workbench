import fs from "node:fs";
import { checkDatabaseIntegrity, closeDatabase, countActiveJobs } from "./db.js";
import { dataRoot, materialRoot, outputRoot } from "./paths.js";

interface CommandResult {
  exitCode: number;
  payload: Record<string, unknown>;
}

function checkIdle(): CommandResult {
  const activeJobs = countActiveJobs();
  return {
    exitCode: activeJobs === 0 ? 0 : 2,
    payload: { ok: activeJobs === 0, idle: activeJobs === 0, activeJobs }
  };
}

function validateData(): CommandResult {
  const directories = [dataRoot, outputRoot, materialRoot];
  const directoriesValid = directories.every((directory) => {
    try {
      return fs.statSync(directory).isDirectory();
    } catch {
      return false;
    }
  });
  const databaseValid = checkDatabaseIntegrity();
  const ok = databaseValid && directoriesValid;
  return {
    exitCode: ok ? 0 : 3,
    payload: { ok, database: databaseValid ? "ok" : "invalid", directories: directoriesValid ? "ok" : "invalid" }
  };
}

function run(command: string | undefined): CommandResult {
  if (command === "check-idle") return checkIdle();
  if (command === "validate-data") return validateData();
  return { exitCode: 1, payload: { ok: false, error: "usage: maintenance <check-idle|validate-data>" } };
}

try {
  const result = run(process.argv[2]);
  console.log(JSON.stringify(result.payload));
  process.exitCode = result.exitCode;
} catch {
  console.log(JSON.stringify({ ok: false, error: "maintenance check failed" }));
  process.exitCode = 3;
} finally {
  closeDatabase();
}
