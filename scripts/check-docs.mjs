import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const officialFiles = [
  "README.md",
  "CHANGELOG.md",
  "docs/USER-GUIDE.md",
  "docs/DEVELOPMENT.md",
  "docs/DEPLOYMENT.md"
];
const requiredFiles = [...officialFiles, "docs/internal/README.md"];
const forbiddenPaths = [
  "docs/PROJECT-MANUAL.md",
  "docs/deployment/linux-docker.md",
  "docs/superpowers"
];

function fail(message) {
  failures.push(message);
}

function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", ".git", ".worktrees"].includes(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".md") ? [absolute] : [];
  });
}

function slugHeadings(markdown, relativeFile, validateStructure = true) {
  const slugs = new Set();
  const counts = new Map();
  let previousLevel = 0;
  let fenceMarker;

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence && (!fenceMarker || fence[0] === fenceMarker)) {
      fenceMarker = fenceMarker ? undefined : fence[0];
      continue;
    }
    if (fenceMarker) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#?\s*$/.exec(line);
    if (!match) continue;
    const level = match[1].length;
    if (validateStructure && previousLevel > 0 && level > previousLevel + 1) {
      fail(`${relativeFile}:${index + 1} 标题层级从 H${previousLevel} 跳到 H${level}`);
    }
    previousLevel = level;
    const base = match[2]
      .trim()
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count === 0 ? base : `${base}-${count}`);
  }

  if (validateStructure && fenceMarker) fail(`${relativeFile} 存在未闭合的代码围栏`);
  return slugs;
}

function verifyLinks(absoluteFile, markdown, headingsByFile) {
  const relativeFile = path.relative(root, absoluteFile).replaceAll("\\", "/");
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|data:)/i.test(rawTarget)) continue;
    const [rawPath, fragment] = rawTarget.split("#", 2);
    let decodedPath;
    let decodedFragment;
    try {
      decodedPath = decodeURIComponent(rawPath || "");
      decodedFragment = fragment ? decodeURIComponent(fragment).toLowerCase() : undefined;
    } catch {
      fail(`${relativeFile} 包含无效 URL 编码的本地链接: ${rawTarget}`);
      continue;
    }
    const targetFile = decodedPath
      ? path.resolve(path.dirname(absoluteFile), decodedPath)
      : absoluteFile;
    if (!existsSync(targetFile)) {
      fail(`${relativeFile} 包含不存在的本地链接: ${rawTarget}`);
      continue;
    }
    if (fragment && targetFile.endsWith(".md")) {
      const normalized = path.normalize(targetFile);
      const targetHeadings = headingsByFile.get(normalized);
      if (!targetHeadings?.has(decodedFragment)) {
        fail(`${relativeFile} 包含不存在的标题锚点: ${rawTarget}`);
      }
    }
  }
}

for (const required of requiredFiles) {
  const absolute = path.join(root, required);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) fail(`缺少正式文档: ${required}`);
}
for (const forbidden of forbiddenPaths) {
  if (existsSync(path.join(root, forbidden))) fail(`仍存在已废弃文档路径: ${forbidden}`);
}

const files = [path.join(root, "README.md"), ...markdownFiles(path.join(root, "docs"))]
  .filter((file, index, all) => all.indexOf(file) === index && existsSync(file));
const headingsByFile = new Map();
const contents = new Map();
for (const file of files) {
  const markdown = readFileSync(file, "utf8");
  const relativeFile = path.relative(root, file).replaceAll("\\", "/");
  contents.set(file, markdown);
  const validateStructure = !relativeFile.startsWith("docs/internal/");
  headingsByFile.set(path.normalize(file), slugHeadings(markdown, relativeFile, validateStructure));
}
for (const [file, markdown] of contents) verifyLinks(file, markdown, headingsByFile);

for (const official of officialFiles) {
  const absolute = path.join(root, official);
  if (!existsSync(absolute)) continue;
  const markdown = readFileSync(absolute, "utf8");
  if (/\b(?:TBD|TODO|FIXME)\b|replace[-_]me/i.test(markdown)) {
    fail(`${official} 包含未完成占位内容`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log(`文档检查通过，共检查 ${files.length} 个 Markdown 文件。`);
