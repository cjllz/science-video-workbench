import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const requiredFiles = [
  "README.md",
  "docs/PROJECT-MANUAL.md",
  "docs/internal/README.md"
];
const forbiddenPaths = [
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

function slugHeadings(markdown, relativeFile) {
  const slugs = new Set();
  const counts = new Map();
  let previousLevel = 0;
  let fence = false;

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (/^\s*```/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#?\s*$/.exec(line);
    if (!match) continue;
    const level = match[1].length;
    if (previousLevel > 0 && level > previousLevel + 1) {
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

  if (fence) fail(`${relativeFile} 存在未闭合的代码围栏`);
  return slugs;
}

function verifyLinks(absoluteFile, markdown, headingsByFile) {
  const relativeFile = path.relative(root, absoluteFile).replaceAll("\\", "/");
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of markdown.matchAll(linkPattern)) {
    const rawTarget = match[1].replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|data:)/i.test(rawTarget)) continue;
    const [rawPath, fragment] = rawTarget.split("#", 2);
    const decodedPath = decodeURIComponent(rawPath || "");
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
      if (!targetHeadings?.has(decodeURIComponent(fragment).toLowerCase())) {
        fail(`${relativeFile} 包含不存在的标题锚点: ${rawTarget}`);
      }
    }
  }
}

for (const required of requiredFiles) {
  if (!existsSync(path.join(root, required))) fail(`缺少正式文档: ${required}`);
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
  headingsByFile.set(path.normalize(file), slugHeadings(markdown, relativeFile));
}
for (const [file, markdown] of contents) verifyLinks(file, markdown, headingsByFile);

for (const official of ["README.md", "docs/PROJECT-MANUAL.md"]) {
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
