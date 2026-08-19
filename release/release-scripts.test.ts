import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "..");
const releaseRoot = path.join(projectRoot, "release");
const directBash = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0 ? "bash" : undefined;
const gitExecPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim();
const gitBash = gitExecPath ? path.resolve(gitExecPath, "..", "..", "..", "bin", "bash.exe") : undefined;
const bash = directBash ?? (gitBash && existsSync(gitBash) ? gitBash : undefined);

function bashPath(value: string): string {
  const match = value.match(/^([A-Za-z]):\\(.*)$/);
  return match ? `/${match[1].toLowerCase()}/${match[2].replaceAll("\\", "/")}` : value;
}

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
    expect(install).toContain('initialize_data_directory "$DATA_DIR"');
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

  it.skipIf(!bash)("passes Bash syntax validation", () => {
    for (const name of ["lib.sh", "configure.sh", "install.sh", "update.sh", "uninstall.sh"]) {
      const file = path.join(releaseRoot, name);
      expect(existsSync(file), `missing release/${name}`).toBe(true);
      const result = spawnSync(bash!, ["-n", file], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    }
  });

  it.skipIf(!bash)("rejects unsupported install environments before mutation", () => {
    const install = bashPath(path.join(releaseRoot, "install.sh"));
    const nonRoot = spawnSync(bash!, ["-c", `id() { printf '1000\\n'; }; source '${install}'`], { encoding: "utf8" });
    expect(nonRoot.status).not.toBe(0);
    expect(nonRoot.stderr).toContain("run this command with sudo");

    const wrongArchitecture = spawnSync(
      bash!,
      ["-c", `id() { printf '0\\n'; }; uname() { [[ "$1" == '-s' ]] && printf 'Linux\\n' || printf 'aarch64\\n'; }; source '${install}'`],
      { encoding: "utf8" }
    );
    expect(wrongArchitecture.status).not.toBe(0);
    expect(wrongArchitecture.stderr).toContain("linux/amd64 only");

    const missingCompose = spawnSync(
      bash!,
      ["-c", `id() { printf '0\\n'; }; uname() { [[ "$1" == '-s' ]] && printf 'Linux\\n' || printf 'x86_64\\n'; }; docker() { return 1; }; source '${install}'`],
      { encoding: "utf8" }
    );
    expect(missingCompose.status).not.toBe(0);
    expect(missingCompose.stderr).toContain("Docker Compose v2 is required");
  });

  it.skipIf(!bash)("writes a complete non-interactive production environment", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "science-video-release-config-"));
    const environmentFile = path.join(temporaryRoot, "deploy", ".env.production");
    const bundleRoot = path.join(temporaryRoot, "bundle");
    const markerFile = path.join(temporaryRoot, "command-substitution-must-not-run");
    const apiKey = `sk-$(touch ${bashPath(markerFile)})-$UNBOUND&literal`;
    try {
      mkdirSync(bundleRoot, { recursive: true });
      copyFileSync(path.join(releaseRoot, "configure.sh"), path.join(bundleRoot, "configure.sh"));
      copyFileSync(path.join(releaseRoot, "lib.sh"), path.join(bundleRoot, "lib.sh"));
      writeFileSync(path.join(bundleRoot, "VERSION"), "0.1.0\n");
      const command = `id() { printf '0\\n'; }; uname() { printf 'Linux\\n'; }; source '${bashPath(path.join(bundleRoot, "configure.sh"))}'`;
      const result = spawnSync(bash!, ["-c", command], {
        encoding: "utf8",
        env: {
          ...process.env,
          NONINTERACTIVE: "1",
          ENV_FILE: bashPath(environmentFile),
          INSTALL_ROOT: bashPath(path.join(temporaryRoot, "app")),
          APP_VERSION: "9.9.9",
          LAN_ACCESS_TOKEN: "test-access-token-1234",
          OPENAI_API_KEY: apiKey
        }
      });
      expect(result.status, result.stderr).toBe(0);
      const environment = readFileSync(environmentFile, "utf8");
      expect(environment).toContain("APP_IMAGE='ghcr.io/cjllz/science-video-workbench'");
      expect(environment).toContain("APP_VERSION='0.1.0'");
      const verify = spawnSync(
        bash!,
        ["-c", `set -u; source '${bashPath(environmentFile)}'; [[ "$APP_VERSION" == '0.1.0' && "$OPENAI_API_KEY" == '${apiKey}' ]]`],
        { encoding: "utf8" }
      );
      expect(verify.status, verify.stderr).toBe(0);
      expect(existsSync(markerFile)).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!bash)("rejects invalid bundle versions", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "science-video-release-version-"));
    try {
      copyFileSync(path.join(releaseRoot, "configure.sh"), path.join(temporaryRoot, "configure.sh"));
      copyFileSync(path.join(releaseRoot, "lib.sh"), path.join(temporaryRoot, "lib.sh"));
      writeFileSync(path.join(temporaryRoot, "VERSION"), "latest\n");
      const command = `id() { printf '0\\n'; }; uname() { printf 'Linux\\n'; }; source '${bashPath(path.join(temporaryRoot, "configure.sh"))}'`;
      const result = spawnSync(bash!, ["-c", command], {
        encoding: "utf8",
        env: { ...process.env, NONINTERACTIVE: "1", LAN_ACCESS_TOKEN: "test-access-token-1234" }
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("VERSION is invalid");
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!bash)("refuses unclaimed and installation-overlapping persistent directories", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "science-video-release-paths-"));
    const dataDirectory = path.join(temporaryRoot, "data");
    const backupDirectory = path.join(temporaryRoot, "backups");
    const installRoot = path.join(temporaryRoot, "service", "app");
    try {
      mkdirSync(dataDirectory);
      mkdirSync(backupDirectory);
      writeFileSync(path.join(dataDirectory, ".science-video-workbench-data"), "wrong-project\n");
      writeFileSync(path.join(backupDirectory, "unrelated.txt"), "keep\n");
      const library = bashPath(path.join(releaseRoot, "lib.sh"));
      const invalidData = spawnSync(bash!, ["-c", `source '${library}'; initialize_data_directory '${bashPath(dataDirectory)}'`], { encoding: "utf8" });
      expect(invalidData.status).not.toBe(0);
      expect(readFileSync(path.join(dataDirectory, ".science-video-workbench-data"), "utf8")).toBe("wrong-project\n");
      const invalidBackup = spawnSync(bash!, ["-c", `source '${library}'; require_backup_layout '${bashPath(backupDirectory)}'`], { encoding: "utf8" });
      expect(invalidBackup.status).not.toBe(0);
      const overlapping = spawnSync(
        bash!,
        ["-c", `INSTALL_ROOT='${bashPath(installRoot)}'; source '${library}'; resolve_safe_directory BACKUP_DIR '${bashPath(path.dirname(installRoot))}'`],
        { encoding: "utf8" }
      );
      expect(overlapping.status).not.toBe(0);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it.skipIf(!bash)("preserves both persistent directories when backup ownership is unproven", () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), "science-video-release-uninstall-"));
    const dataDirectory = path.join(temporaryRoot, "data");
    const backupDirectory = path.join(temporaryRoot, "backups");
    const environmentFile = path.join(temporaryRoot, ".env.production");
    try {
      mkdirSync(dataDirectory);
      mkdirSync(backupDirectory);
      writeFileSync(path.join(dataDirectory, ".science-video-workbench-data"), "science-video-workbench-data-v1\n");
      writeFileSync(path.join(backupDirectory, "unrelated.txt"), "keep\n");
      writeFileSync(
        environmentFile,
        `DATA_DIR='${bashPath(dataDirectory)}'\nBACKUP_DIR='${bashPath(backupDirectory)}'\n`
      );
      const uninstall = bashPath(path.join(releaseRoot, "uninstall.sh"));
      const result = spawnSync(
        bash!,
        ["-c", `id() { printf '0\\n'; }; uname() { printf 'Linux\\n'; }; docker() { return 0; }; source '${uninstall}' --destroy-data --confirm-destroy-data`],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            ENV_FILE: bashPath(environmentFile),
            INSTALL_ROOT: bashPath(path.join(temporaryRoot, "app"))
          }
        }
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("backup sentinel");
      expect(existsSync(dataDirectory)).toBe(true);
      expect(existsSync(backupDirectory)).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("allows packaged maintenance scripts to select the release Compose file", () => {
    const releaseLibrary = releaseFile("lib.sh");
    const install = releaseFile("install.sh");
    expect(releaseLibrary).toContain('COMPOSE_FILE="${COMPOSE_FILE:-$INSTALL_ROOT/compose.yaml}"');
    expect(install).toContain('"$SCRIPT_DIR/compose.release.yaml" "$INSTALL_ROOT/compose.yaml"');
    expect(install).toContain('"$SCRIPT_DIR/VERSION" "$INSTALL_ROOT/VERSION"');
    expect(install).toContain('[[ "$APP_VERSION" == "$bundle_version" ]]');

    const deploymentLibrary = readFileSync(path.join(projectRoot, "deploy", "lib.sh"), "utf8");
    expect(deploymentLibrary).toContain('COMPOSE_FILE="${COMPOSE_FILE:-$PROJECT_ROOT/compose.yaml}"');
    expect(deploymentLibrary).toContain('-f "$COMPOSE_FILE"');
  });

  it("publishes verified tag releases and the public amd64 image", () => {
    const workflow = readFileSync(path.join(projectRoot, ".github", "workflows", "release.yml"), "utf8");
    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("actions/checkout@v7");
    expect(workflow).toContain("actions/setup-node@v7");
    expect(workflow).toContain("docker/login-action@v4");
    expect(workflow).toContain("docker/setup-buildx-action@v4");
    expect(workflow).toContain("docker/build-push-action@v7");
    expect(workflow).toContain("npm run verify");
    expect(workflow).toContain("npm audit --omit=dev");
    expect(workflow).toContain("npm run release:package");
    expect(workflow).toContain("platforms: linux/amd64");
    expect(workflow).toContain("ghcr.io/cjllz/science-video-workbench");
    expect(workflow).toContain("docker logout ghcr.io");
    expect(workflow).toContain("docker pull \"ghcr.io/cjllz/science-video-workbench:${{ steps.version.outputs.value }}\"");
    expect(workflow).toContain('gh release create "$GITHUB_REF_NAME"');
    expect(workflow).toContain("SHA256SUMS");
  });

  it("prints actionable rollback state when an update is not ready", () => {
    const update = releaseFile("update.sh");
    expect(update).toContain("previous_version=\"$APP_VERSION\"");
    expect(update).toContain("environment_backup=");
    expect(update).toContain("backup_archive=");
    expect(update).toContain("restore.sh");
    expect(update).toContain("previous version: %s");
    expect(update.indexOf("check-idle")).toBeLessThan(update.indexOf("backup.sh"));
    expect(update.indexOf("backup_archive=")).toBeLessThan(update.indexOf("replace_environment_value"));
    expect(update.indexOf("replace_environment_value")).toBeLessThan(update.indexOf("compose_cmd pull"));
  });
});
