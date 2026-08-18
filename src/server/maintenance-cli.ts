import { validateDataDirectory } from "./maintenance-validation.js";
import { dataRoot } from "./paths.js";

interface CommandResult {
  exitCode: number;
  payload: Record<string, unknown>;
}

async function checkIdle(): Promise<CommandResult> {
  const { closeDatabase, countActiveJobs } = await import("./db.js");
  try {
    const activeJobs = countActiveJobs();
    return {
      exitCode: activeJobs === 0 ? 0 : 2,
      payload: { ok: activeJobs === 0, idle: activeJobs === 0, activeJobs }
    };
  } finally {
    closeDatabase();
  }
}

function validateData(): CommandResult {
  const validation = validateDataDirectory(dataRoot);
  return {
    exitCode: validation.ok ? 0 : 3,
    payload: validation.ok ? { ok: true } : { ok: false, component: validation.reason }
  };
}

async function run(command: string | undefined): Promise<CommandResult> {
  if (command === "check-idle") return await checkIdle();
  if (command === "validate-data") return validateData();
  return { exitCode: 1, payload: { ok: false, error: "usage: maintenance <check-idle|validate-data>" } };
}

async function main(): Promise<void> {
  try {
    const result = await run(process.argv[2]);
    console.log(JSON.stringify(result.payload));
    process.exitCode = result.exitCode;
  } catch {
    console.log(JSON.stringify({ ok: false, error: "maintenance check failed" }));
    process.exitCode = 3;
  }
}

void main();
