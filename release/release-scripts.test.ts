import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const releaseRoot = path.join(projectRoot, "release");
const bashAvailable = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;

function releaseFile(name: string): string {
  const file = path.join(releaseRoot, name);
  expect(existsSync(file), `missing release/${name}`).toBe(true);
  return readFileSync(file, "utf8");
}

describe("server release contracts", () => {
  it("uses a fixed public image without a source build", () => {
    const compose = releaseFile("compose.release.yaml");
    expect(compose).toContain("image: ${APP_IMAGE:?APP_IMAGE must be set}:${APP_VERSION:?APP_VERSION must be set}");
    expect(compose).toContain("platform: linux/amd64");
    expect(compose).not.toContain("build:");
    expect(compose).not.toMatch(/ports:[\s\S]*8787:8787/);
  });

  it("guards installation and persistent data", () => {
    const install = releaseFile("install.sh");
    expect(install).toContain("require_root");
    expect(install).toContain("require_amd64");
    expect(install).toContain("Docker Compose v2 is required");
    expect(install).toContain(".science-video-workbench-data");
    expect(install).toContain("wait_for_readiness");
  });

  it("requires an idle service and backup before update", () => {
    const update = releaseFile("update.sh");
    expect(update).toContain("check-idle");
    expect(update).toContain("backup.sh");
    expect(update).toContain("previous_image_id");
    expect(update).toContain("wait_for_readiness");
  });

  it("preserves persistent state unless destruction is explicitly confirmed", () => {
    const uninstall = releaseFile("uninstall.sh");
    expect(uninstall).toContain("--destroy-data");
    expect(uninstall).toContain("--confirm-destroy-data");
    expect(uninstall).not.toContain("down --volumes");
    expect(uninstall).toContain("require_data_layout");
  });

  it.skipIf(!bashAvailable)("passes Bash syntax validation", () => {
    for (const name of ["lib.sh", "configure.sh", "install.sh", "update.sh", "uninstall.sh"]) {
      const file = path.join(releaseRoot, name);
      expect(existsSync(file), `missing release/${name}`).toBe(true);
      const result = spawnSync("bash", ["-n", file], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
  });
});
