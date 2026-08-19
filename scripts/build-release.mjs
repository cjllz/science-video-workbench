import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error("package.json version must be MAJOR.MINOR.PATCH");
}

let outputDirectory = path.join(projectRoot, ".artifacts", "releases");
if (process.argv.length > 2) {
  if (process.argv.length !== 4 || process.argv[2] !== "--output-dir" || !process.argv[3]) {
    throw new Error("usage: node scripts/build-release.mjs [--output-dir <directory>]");
  }
  outputDirectory = path.resolve(process.argv[3]);
}

const files = new Map([
  ["release/README.txt", "README.txt"],
  ["release/compose.release.yaml", "compose.release.yaml"],
  ["release/Caddyfile", "Caddyfile"],
  ["release/.env.production.example", "deploy/.env.production.example"],
  ["release/lib.sh", "lib.sh"],
  ["release/configure.sh", "configure.sh"],
  ["release/install.sh", "install.sh"],
  ["release/update.sh", "update.sh"],
  ["release/uninstall.sh", "uninstall.sh"],
  ["deploy/backup.sh", "deploy/backup.sh"],
  ["deploy/restore.sh", "deploy/restore.sh"],
  ["deploy/lib.sh", "deploy/lib.sh"]
]);
const executableTargets = new Set([...files.values()].filter((target) => target.endsWith(".sh")));

for (const source of files.keys()) {
  if (!existsSync(path.join(projectRoot, source))) throw new Error(`release source is missing: ${source}`);
}

mkdirSync(outputDirectory, { recursive: true });
const rootName = `science-video-workbench-v${version}`;
const archiveName = `${rootName}-online-linux-amd64.tar.gz`;
const archivePath = path.join(outputDirectory, archiveName);
const checksumPath = `${archivePath}.sha256`;
const checksumManifestPath = path.join(outputDirectory, "SHA256SUMS");
for (const target of [archivePath, checksumPath, checksumManifestPath]) {
  if (existsSync(target)) throw new Error(`refusing to overwrite existing release asset: ${target}`);
}

const stagingDirectory = mkdtempSync(path.join(tmpdir(), "science-video-release-stage-"));
try {
  const packageRoot = path.join(stagingDirectory, rootName);
  for (const [source, target] of files) {
    const destination = path.join(packageRoot, target);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(path.join(projectRoot, source), destination);
    chmodSync(destination, executableTargets.has(target) ? 0o755 : 0o644);
  }
  writeFileSync(path.join(packageRoot, "VERSION"), `${version}\n`, { mode: 0o644 });

  let tarCommand = "tar";
  let tarPathForCommand;
  let stagingDirectoryForCommand;
  if (process.platform === "win32") {
    const gitExecPath = spawnSync("git", ["--exec-path"], { encoding: "utf8" }).stdout.trim();
    const gitTar = gitExecPath ? path.resolve(gitExecPath, "..", "..", "..", "usr", "bin", "tar.exe") : "";
    if (gitTar && existsSync(gitTar)) tarCommand = gitTar;
  }
  const tarPath = path.join(stagingDirectory, "release.tar");
  const commandPath = (value) => process.platform === "win32"
    ? value.replace(/^([A-Za-z]):\\/, (_, drive) => `/${drive.toLowerCase()}/`).replaceAll("\\", "/")
    : value;
  tarPathForCommand = commandPath(tarPath);
  stagingDirectoryForCommand = commandPath(stagingDirectory);
  const executableEntries = [...executableTargets].map((target) => `${rootName}/${target}`);
  const regularEntries = [...files.values(), "VERSION"]
    .filter((target) => !executableTargets.has(target))
    .map((target) => `${rootName}/${target}`);
  const createTar = spawnSync(
    tarCommand,
    ["-cf", tarPathForCommand, "--format=ustar", "--mode=0755", "--no-recursion", "-C", stagingDirectoryForCommand, ...executableEntries],
    { encoding: "utf8" }
  );
  if (createTar.status !== 0) throw new Error(`tar failed: ${createTar.stderr || createTar.stdout}`);
  const appendTar = spawnSync(
    tarCommand,
    ["-rf", tarPathForCommand, "--format=ustar", "--mode=0644", "--no-recursion", "-C", stagingDirectoryForCommand, ...regularEntries],
    { encoding: "utf8" }
  );
  if (appendTar.status !== 0) throw new Error(`tar append failed: ${appendTar.stderr || appendTar.stdout}`);
  writeFileSync(archivePath, gzipSync(readFileSync(tarPath)));

  const hash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  const checksumLine = `${hash}  ${archiveName}\n`;
  writeFileSync(checksumPath, checksumLine);
  writeFileSync(checksumManifestPath, checksumLine);
  process.stdout.write(`${archivePath}\n${checksumPath}\n${checksumManifestPath}\n`);
} catch (error) {
  for (const target of [archivePath, checksumPath, checksumManifestPath]) {
    if (existsSync(target)) unlinkSync(target);
  }
  throw error;
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
}
