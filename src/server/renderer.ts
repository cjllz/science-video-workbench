import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import type { DataAsset, DataCell, MaterialAsset, MaterialPlacement, ShotMaterialBinding, ShotPlan, VideoBrief, VideoPlan } from "../shared/video.js";
import { VIDEO_STYLES } from "../shared/video.js";
import { getMaterialStoragePath } from "./db.js";
import { projectRoot } from "./paths.js";
import type { GeneratedAsset } from "./providers/video.js";

const ffmpegPath = ffmpegStatic;

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stderr) : reject(new Error(`${command} exited ${code}: ${stderr.slice(-2000)}`)));
  });
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrapText(value: string, maxPerLine: number, maxLines: number): string[] {
  const chars = [...value.replace(/\s+/g, "")];
  const lines: string[] = [];
  while (chars.length && lines.length < maxLines) lines.push(chars.splice(0, maxPerLine).join(""));
  if (chars.length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, -1)}…`;
  return lines;
}

function tspans(lines: string[], x: number, lineHeight: number): string {
  return lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join("");
}

function dimensions(brief: VideoBrief): { width: number; height: number } {
  if (brief.aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (brief.aspectRatio === "3:4") return { width: 1080, height: 1440 };
  return { width: 1080, height: 1920 };
}

export function dataAssetForShot(shot: ShotPlan, materials: MaterialAsset[], directDataAssets: DataAsset[]): DataAsset | undefined {
  const direct = shot.dataAssetId ? directDataAssets.find((asset) => asset.id === shot.dataAssetId) : undefined;
  const binding = (shot.materialBindings ?? []).find((item) => item.mode === "data_chart");
  const material = binding ? materials.find((item) => item.id === binding.materialId) : undefined;
  const source = material?.dataAsset ?? direct;
  if (!source || !binding?.chart) return source;
  const columns = [binding.chart.xColumn, ...binding.chart.yColumns].filter((column, index, all) => column && all.indexOf(column) === index);
  const indices = columns.map((column) => source.columns.indexOf(column));
  if (indices.some((index) => index < 0)) return source;
  return {
    ...source,
    columns,
    rows: source.rows.map((row) => indices.map((index) => row[index] ?? null)),
    numericColumns: binding.chart.yColumns.filter((column) => source.numericColumns.includes(column))
  };
}

function formatDataValue(value: number, column: string): string {
  if ((column.includes("率") || column.includes("%") || column.includes("占比")) && Math.abs(value) <= 1) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function displayCell(value: DataCell): string {
  if (value === null) return "-";
  return typeof value === "number" ? (Number.isInteger(value) ? String(value) : value.toFixed(2)) : value;
}

async function renderDataCard(brief: VideoBrief, plan: VideoPlan, shot: ShotPlan, asset: DataAsset, destination: string): Promise<void> {
  const { width, height } = dimensions(brief);
  const portrait = height > width;
  const style = VIDEO_STYLES.find((item) => item.id === brief.style) ?? VIDEO_STYLES[3];
  const [ink, secondary, accent, paper] = style.palette;
  const margin = Math.round(width * 0.07);
  const title = asset.name.replace(/\.[^.]+$/, "");
  const titleLines = wrapText(title, portrait ? 15 : 26, 2);
  const chartTop = portrait ? 450 : 265;
  const chartHeight = portrait ? 720 : 380;
  const narrationY = portrait ? 1390 : 755;
  const narrationLines = wrapText(shot.narration, portrait ? 19 : 34, portrait ? 4 : 2);
  const numericColumn = asset.numericColumns[0];
  const chartType = shot.materialBindings?.find((binding) => binding.mode === "data_chart")?.chart?.type ?? "bar";
  const numericIndex = numericColumn ? asset.columns.indexOf(numericColumn) : -1;
  const labelIndex = asset.columns.findIndex((_column, index) => index !== numericIndex);
  const pairs = numericIndex >= 0
    ? asset.rows.map((row, index) => ({ label: displayCell(row[labelIndex >= 0 ? labelIndex : 0] ?? `第${index + 1}项`), value: row[numericIndex] })).filter((item): item is { label: string; value: number } => typeof item.value === "number").slice(0, 6)
    : [];
  const maxValue = Math.max(1, ...pairs.map((item) => Math.abs(item.value)));
  const labelWidth = portrait ? 175 : 230;
  const barStart = margin + labelWidth;
  const maxBarWidth = width - barStart - margin - (portrait ? 110 : 150);
  const rowHeight = chartHeight / Math.max(pairs.length, 1);

  const bars = chartType === "bar" ? pairs.map((item, index) => {
    const y = chartTop + index * rowHeight + rowHeight * 0.2;
    const barHeight = rowHeight * 0.48;
    const barWidth = Math.max(8, (Math.abs(item.value) / maxValue) * maxBarWidth);
    return `
      <text x="${margin}" y="${y + barHeight * 0.72}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 27 : 23}" font-weight="700" fill="${ink}">${escapeXml(item.label.slice(0, portrait ? 8 : 13))}</text>
      <rect x="${barStart}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="${index % 2 === 0 ? secondary : accent}"/>
      <text x="${Math.min(width - margin, barStart + barWidth + 16)}" y="${y + barHeight * 0.72}" font-family="Georgia, Microsoft YaHei, sans-serif" font-size="${portrait ? 25 : 22}" font-weight="700" fill="${ink}">${escapeXml(formatDataValue(item.value, numericColumn))}</text>`;
  }).join("") : "";

  const lineLeft = margin + (portrait ? 80 : 105);
  const lineRight = width - margin - (portrait ? 45 : 65);
  const lineBottom = chartTop + chartHeight - (portrait ? 75 : 55);
  const lineTop = chartTop + 25;
  const linePoints = pairs.map((item, index) => {
    const x = lineLeft + (index / Math.max(pairs.length - 1, 1)) * (lineRight - lineLeft);
    const y = lineBottom - (Math.max(0, item.value) / maxValue) * (lineBottom - lineTop);
    return { ...item, x, y };
  });
  const line = chartType === "line" && linePoints.length ? `
    <path d="M ${lineLeft} ${lineTop} V ${lineBottom} H ${lineRight}" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width="2"/>
    <polyline points="${linePoints.map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="${secondary}" stroke-width="${portrait ? 12 : 8}" stroke-linejoin="round" stroke-linecap="round"/>
    ${linePoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="${portrait ? 10 : 7}" fill="${accent}"/><text x="${point.x}" y="${point.y - 22}" text-anchor="middle" font-family="Georgia, Microsoft YaHei, sans-serif" font-size="${portrait ? 22 : 17}" font-weight="700" fill="${ink}">${escapeXml(formatDataValue(point.value, numericColumn))}</text><text x="${point.x}" y="${lineBottom + (portrait ? 42 : 32)}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 19 : 15}" fill="${ink}" opacity=".7">${escapeXml(point.label.slice(0, 6))}</text>`).join("")}` : "";

  const tableColumns = asset.columns.slice(0, portrait ? 3 : 4);
  const tableRows = asset.rows.slice(0, 5);
  const cellWidth = (width - margin * 2) / Math.max(tableColumns.length, 1);
  const tableRowHeight = portrait ? 92 : 58;
  const table = chartType !== "table" && pairs.length ? "" : `
    ${tableColumns.map((column, index) => `<rect x="${margin + index * cellWidth}" y="${chartTop}" width="${cellWidth}" height="${tableRowHeight}" fill="${ink}"/><text x="${margin + index * cellWidth + 14}" y="${chartTop + tableRowHeight * .62}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 23 : 19}" font-weight="700" fill="${paper}">${escapeXml(column.slice(0, 10))}</text>`).join("")}
    ${tableRows.map((row, rowIndex) => tableColumns.map((_column, columnIndex) => `<rect x="${margin + columnIndex * cellWidth}" y="${chartTop + (rowIndex + 1) * tableRowHeight}" width="${cellWidth}" height="${tableRowHeight}" fill="${rowIndex % 2 ? paper : "#ffffff"}" stroke="${ink}" stroke-opacity=".16"/><text x="${margin + columnIndex * cellWidth + 14}" y="${chartTop + (rowIndex + 1) * tableRowHeight + tableRowHeight * .62}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 22 : 18}" fill="${ink}">${escapeXml(displayCell(row[columnIndex]).slice(0, 12))}</text>`).join("")).join("")}`;

  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${paper}"/>
      <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="${ink}" stroke-opacity="0.05" stroke-width="1"/></pattern></defs>
      <rect width="${width}" height="${height}" fill="url(#grid)"/>
      <rect x="0" y="0" width="${portrait ? 18 : 14}" height="${height}" fill="${secondary}"/>
      <text x="${margin}" y="${portrait ? 105 : 66}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 27 : 22}" font-weight="700" fill="${ink}">上传数据 · 精确渲染</text>
      <text x="${margin}" y="${portrait ? 235 : 150}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 62 : 50}" font-weight="800" fill="${ink}">${tspans(titleLines, margin, portrait ? 76 : 60)}</text>
      <text x="${margin}" y="${chartTop - 48}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 25 : 20}" fill="${ink}" opacity=".66">${escapeXml(numericColumn ? `${numericColumn} · 前 ${pairs.length} 条记录` : `表格预览 · 共 ${asset.rowCount} 条记录`)}</text>
      ${bars}${line}${table}
      <rect x="${margin}" y="${narrationY - 60}" width="${width - margin * 2}" height="${portrait ? 310 : 180}" rx="6" fill="${ink}"/>
      <text x="${margin + 32}" y="${narrationY}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 36 : 29}" fill="${paper}">${tspans(narrationLines, margin + 32, portrait ? 52 : 42)}</text>
      <text x="${margin}" y="${height - 92}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 24 : 19}" fill="${ink}" opacity=".62">数据来源：用户上传 · ${asset.rowCount} 条记录</text>
      <text x="${width - margin}" y="${height - 92}" text-anchor="end" font-family="Georgia, sans-serif" font-size="${portrait ? 26 : 21}" fill="${ink}">${String(shot.index + 1).padStart(2, "0")} / ${String(plan.shots.length).padStart(2, "0")}</text>
    </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(destination);
}

async function renderCard(brief: VideoBrief, plan: VideoPlan, shot: ShotPlan, destination: string, dataAsset?: DataAsset): Promise<void> {
  if (shot.assetType === "data_visualization" && dataAsset) {
    await renderDataCard(brief, plan, shot, dataAsset, destination);
    return;
  }
  const { width, height } = dimensions(brief);
  const portrait = height > width;
  const style = VIDEO_STYLES.find((item) => item.id === brief.style) ?? VIDEO_STYLES[0];
  const [ink, secondary, accent, paper] = style.palette;
  const margin = Math.round(width * 0.075);
  const titleSize = portrait ? 72 : 66;
  const subtitleSize = portrait ? 42 : 34;
  const headlineLines = wrapText(shot.headline, portrait ? 11 : 18, 3);
  const narrationLines = wrapText(shot.narration, portrait ? 18 : 32, portrait ? 4 : 3);
  const headlineY = portrait ? Math.round(height * 0.31) : Math.round(height * 0.3);
  const subtitleY = portrait ? Math.round(height * 0.76) : Math.round(height * 0.73);
  const ringX = portrait ? width * 0.78 : width * 0.82;
  const ringY = portrait ? height * 0.24 : height * 0.32;
  const ringR = portrait ? width * 0.16 : height * 0.2;
  const progressWidth = width - margin * 2;
  const progress = progressWidth * ((shot.index + 1) / plan.shots.length);

  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${paper}"/>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${ink}" stroke-opacity="0.055" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grid)"/>
      <rect x="0" y="0" width="${portrait ? 18 : 14}" height="${height}" fill="${accent}"/>
      <circle cx="${ringX}" cy="${ringY}" r="${ringR}" fill="none" stroke="${secondary}" stroke-width="${portrait ? 28 : 20}" opacity="0.92"/>
      <circle cx="${ringX}" cy="${ringY}" r="${ringR * 0.56}" fill="${accent}" opacity="0.92"/>
      <path d="M ${margin} ${headlineY - 80} H ${width * 0.56}" stroke="${accent}" stroke-width="8"/>
      <text x="${margin}" y="${portrait ? 122 : 76}" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 28 : 24}" font-weight="700" fill="${ink}" letter-spacing="0">科普影像实验室 · ${escapeXml(style.name)}</text>
      <text x="${margin}" y="${headlineY}" font-family="Microsoft YaHei, sans-serif" font-size="${titleSize}" font-weight="800" fill="${ink}" letter-spacing="0">${tspans(headlineLines, margin, titleSize * 1.25)}</text>
      <rect x="${margin}" y="${subtitleY - 68}" width="${progressWidth}" height="${portrait ? 330 : 190}" rx="6" fill="${ink}"/>
      <text x="${margin + 38}" y="${subtitleY}" font-family="Microsoft YaHei, sans-serif" font-size="${subtitleSize}" font-weight="500" fill="${paper}" letter-spacing="0">${tspans(narrationLines, margin + 38, subtitleSize * 1.45)}</text>
      <text x="${width - margin}" y="${height - 92}" text-anchor="end" font-family="Microsoft YaHei, sans-serif" font-size="${portrait ? 28 : 22}" fill="${ink}" letter-spacing="0">${String(shot.index + 1).padStart(2, "0")} / ${String(plan.shots.length).padStart(2, "0")}</text>
      <rect x="${margin}" y="${height - 58}" width="${progressWidth}" height="8" fill="${ink}" opacity="0.12"/>
      <rect x="${margin}" y="${height - 58}" width="${progress}" height="8" fill="${accent}"/>
    </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(destination);
}

async function renderSegment(input: GeneratedAsset, imagePath: string, outputPath: string, duration: number, brief: VideoBrief): Promise<void> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  const { width, height } = dimensions(brief);
  const fadeOut = Math.max(0, duration - 0.3).toFixed(2);
  const commonFilter = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOut}:d=0.25,format=yuv420p`;
  if (input.kind === "video") {
    const timingFilter = input.provider.startsWith("ark:") || input.provider === "cache" ? `setpts=${(duration / 5).toFixed(4)}*PTS,` : "";
    await run(ffmpegPath, ["-y", "-stream_loop", "-1", "-i", input.path, "-t", duration.toFixed(2), "-vf", `${timingFilter}${commonFilter}`, "-an", "-r", "30", outputPath]);
    return;
  }
  await run(ffmpegPath, ["-y", "-loop", "1", "-framerate", "30", "-i", imagePath, "-t", duration.toFixed(2), "-vf", commonFilter, "-an", "-r", "30", outputPath]);
}

function overlayPosition(placement: MaterialPlacement, margin: number): string {
  if (placement === "top-left") return `${margin}:${margin}`;
  if (placement === "top-right") return `W-w-${margin}:${margin}`;
  if (placement === "bottom-left") return `${margin}:H-h-${margin}`;
  if (placement === "bottom-right") return `W-w-${margin}:H-h-${margin}`;
  return "(W-w)/2:(H-h)/2";
}

export function overlayEnableExpression(binding: ShotMaterialBinding, shotDuration: number): string {
  const start = binding.startOffset ?? 0;
  const end = binding.endOffset ?? shotDuration;
  return `enable='between(t,${start},${end})'`;
}

export function overlayBindingsForShot(shot: ShotPlan): ShotMaterialBinding[] {
  return (shot.materialBindings ?? []).filter((binding) => binding.mode === "exact_overlay" || binding.mode === "data_chart");
}

async function renderDataOverlay(shot: ShotPlan, binding: ShotMaterialBinding, material: MaterialAsset, destination: string): Promise<void> {
  const asset = dataAssetForShot({ ...shot, materialBindings: [binding] }, [material], []);
  if (!asset) throw new Error(`数据素材 @${binding.variableName} 无法渲染`);
  const width = 900;
  const height = 560;
  const margin = 48;
  const chart = binding.chart;
  const numericColumn = chart?.yColumns[0] ?? asset.numericColumns[0];
  const numericIndex = asset.columns.indexOf(numericColumn);
  const labelColumn = chart?.xColumn ?? asset.columns.find((column) => column !== numericColumn) ?? asset.columns[0];
  const labelIndex = asset.columns.indexOf(labelColumn);
  const pairs = numericIndex >= 0 ? asset.rows.map((row, index) => ({
    label: displayCell(row[labelIndex >= 0 ? labelIndex : 0] ?? `第${index + 1}项`),
    value: row[numericIndex]
  })).filter((item): item is { label: string; value: number } => typeof item.value === "number").slice(0, 7) : [];
  const maximum = Math.max(1, ...pairs.map((item) => Math.abs(item.value)));
  const chartType = chart?.type ?? "bar";
  const left = 90;
  const right = width - 70;
  const top = 170;
  const bottom = height - 72;
  const points = pairs.map((item, index) => ({
    ...item,
    x: left + (index / Math.max(pairs.length - 1, 1)) * (right - left),
    y: bottom - (Math.max(0, item.value) / maximum) * (bottom - top)
  }));
  const line = chartType === "line" && points.length ? `
    <path d="M ${left} ${top} V ${bottom} H ${right}" fill="none" stroke="#183331" stroke-opacity=".25" stroke-width="3"/>
    <polyline points="${points.map((point) => `${point.x},${point.y}`).join(" ")}" fill="none" stroke="#218b83" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
    ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="9" fill="#e34a3f"/><text x="${point.x}" y="${point.y - 20}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="20" font-weight="700" fill="#183331">${escapeXml(formatDataValue(point.value, numericColumn))}</text><text x="${point.x}" y="${bottom + 34}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="17" fill="#183331">${escapeXml(point.label.slice(0, 6))}</text>`).join("")}` : "";
  const barWidth = Math.max(24, (right - left) / Math.max(pairs.length, 1) * 0.58);
  const bars = chartType === "bar" ? points.map((point, index) => {
    const barHeight = bottom - point.y;
    return `<rect x="${point.x - barWidth / 2}" y="${point.y}" width="${barWidth}" height="${barHeight}" rx="5" fill="${index % 2 ? "#f0b84c" : "#218b83"}"/><text x="${point.x}" y="${point.y - 14}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="20" font-weight="700" fill="#183331">${escapeXml(formatDataValue(point.value, numericColumn))}</text><text x="${point.x}" y="${bottom + 34}" text-anchor="middle" font-family="Microsoft YaHei, sans-serif" font-size="17" fill="#183331">${escapeXml(point.label.slice(0, 6))}</text>`;
  }).join("") : "";
  const tableColumns = asset.columns.slice(0, 3);
  const cellWidth = (width - margin * 2) / Math.max(tableColumns.length, 1);
  const rowHeight = 58;
  const table = chartType === "table" || !pairs.length ? `
    ${tableColumns.map((column, index) => `<rect x="${margin + index * cellWidth}" y="${top}" width="${cellWidth}" height="${rowHeight}" fill="#183331"/><text x="${margin + index * cellWidth + 12}" y="${top + 37}" font-family="Microsoft YaHei, sans-serif" font-size="18" font-weight="700" fill="#ffffff">${escapeXml(column.slice(0, 10))}</text>`).join("")}
    ${asset.rows.slice(0, 5).map((row, rowIndex) => tableColumns.map((_column, columnIndex) => `<rect x="${margin + columnIndex * cellWidth}" y="${top + (rowIndex + 1) * rowHeight}" width="${cellWidth}" height="${rowHeight}" fill="${rowIndex % 2 ? "#f4f7f5" : "#ffffff"}" stroke="#183331" stroke-opacity=".16"/><text x="${margin + columnIndex * cellWidth + 12}" y="${top + (rowIndex + 1) * rowHeight + 37}" font-family="Microsoft YaHei, sans-serif" font-size="17" fill="#183331">${escapeXml(displayCell(row[asset.columns.indexOf(tableColumns[columnIndex])]).slice(0, 12))}</text>`).join("")).join("")}` : "";
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3" width="${width - 6}" height="${height - 6}" rx="12" fill="#ffffff" stroke="#183331" stroke-width="6"/>
    <rect x="3" y="3" width="16" height="${height - 6}" rx="8" fill="#218b83"/>
    <text x="${margin}" y="66" font-family="Microsoft YaHei, sans-serif" font-size="34" font-weight="800" fill="#183331">${escapeXml(material.name.replace(/\.[^.]+$/, "").slice(0, 24))}</text>
    <text x="${margin}" y="112" font-family="Microsoft YaHei, sans-serif" font-size="20" fill="#60706d">${escapeXml(`${labelColumn} · ${numericColumn || "数据"}`)}</text>
    ${line}${bars}${table}
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(destination);
}

async function applyExactOverlays(segmentPath: string, shot: ShotPlan, materials: MaterialAsset[], brief: VideoBrief): Promise<void> {
  if (!ffmpegPath) return;
  const bindings = overlayBindingsForShot(shot);
  if (!bindings.length) return;
  const { width, height } = dimensions(brief);
  let currentPath = segmentPath;
  let applied = 0;
  for (const binding of bindings) {
    const material = materials.find((item) => item.id === binding.materialId);
    let materialPath = material ? getMaterialStoragePath(material.id) : undefined;
    let inputKind = material?.kind;
    let temporaryDataPath: string | undefined;
    if (material && binding.mode === "data_chart") {
      temporaryDataPath = path.join(path.dirname(segmentPath), `data-overlay-${shot.index}-${applied}.png`);
      await renderDataOverlay(shot, binding, material, temporaryDataPath);
      materialPath = temporaryDataPath;
      inputKind = "image";
    }
    if (!material || !materialPath || !["image", "video"].includes(inputKind ?? "")) continue;
    const maximumWidth = Math.round(width * (binding.placement === "full" ? 0.86 : 0.34));
    const maximumHeight = Math.round(height * (binding.placement === "full" ? 0.86 : 0.34));
    const margin = Math.round(Math.min(width, height) * 0.045);
    const outputPath = path.join(path.dirname(segmentPath), `overlay-${shot.index}-${applied}.mp4`);
    const materialInput = inputKind === "image" ? ["-loop", "1", "-i", materialPath] : ["-stream_loop", "-1", "-i", materialPath];
    await run(ffmpegPath, [
      "-y", "-i", currentPath, ...materialInput, "-t", shot.duration.toFixed(2),
      "-filter_complex", `[1:v]scale=${maximumWidth}:${maximumHeight}:force_original_aspect_ratio=decrease[ov];[0:v][ov]overlay=${overlayPosition(binding.placement, margin)}:${overlayEnableExpression(binding, shot.duration)}:shortest=1,format=yuv420p`,
      "-an", "-r", "30", outputPath
    ]);
    if (currentPath !== segmentPath) await fs.unlink(currentPath).catch(() => undefined);
    currentPath = outputPath;
    if (temporaryDataPath) await fs.unlink(temporaryDataPath).catch(() => undefined);
    applied += 1;
  }
  if (currentPath !== segmentPath) {
    await fs.unlink(segmentPath);
    await fs.rename(currentPath, segmentPath);
  }
}

export async function synthesizeNarration(text: string, outputPath: string, duration: number): Promise<void> {
  const script = path.join(projectRoot, "scripts", "synthesize.ps1");
  try {
    await run("python", ["-m", "edge_tts", "--voice", "zh-CN-XiaoxiaoNeural", "--rate", duration <= 30 ? "+20%" : "+8%", "--text", text, "--write-media", outputPath]);
    return;
  } catch (edgeError) {
    console.warn("Online TTS unavailable, trying Windows voice:", edgeError);
  }
  try {
    await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Text", text, "-OutputPath", outputPath, "-Rate", duration <= 30 ? "2" : "1"]);
  } catch (windowsError) {
    if (!ffmpegPath) throw windowsError;
    console.warn("TTS unavailable, generating silent narration:", windowsError);
    await run(ffmpegPath, ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(duration), outputPath]);
  }
}

function formatSrtTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export async function writeSubtitles(plan: VideoPlan, outputPath: string): Promise<void> {
  let cursor = 0;
  const blocks = plan.shots.map((shot, index) => {
    const start = cursor;
    cursor += shot.duration;
    return `${index + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(cursor)}\n${shot.narration}\n`;
  });
  await fs.writeFile(outputPath, blocks.join("\n"), "utf8");
}

export interface RenderResult {
  outputPath: string;
  posterPath: string;
  subtitlePath: string;
}

export async function renderVideo(
  brief: VideoBrief,
  plan: VideoPlan,
  directory: string,
  assets: GeneratedAsset[],
  dataAssets: DataAsset[],
  materials: MaterialAsset[] = [],
  onShotRendered?: (index: number) => void
): Promise<RenderResult> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  await fs.mkdir(directory, { recursive: true });
  const narrationPath = path.join(directory, "narration.mp3");
  const subtitlePath = path.join(directory, "captions.srt");
  await synthesizeNarration(plan.script, narrationPath, brief.duration);
  await writeSubtitles(plan, subtitlePath);

  const segments: string[] = [];
  const dataAssetMap = new Map(dataAssets.map((asset) => [asset.id, asset]));
  let posterPath = "";
  for (const shot of plan.shots) {
    const imagePath = path.join(directory, `shot-${shot.index}.png`);
    const segmentPath = path.join(directory, `segment-${shot.index}.mp4`);
    await renderCard(brief, plan, shot, imagePath, dataAssetForShot(shot, materials, [...dataAssetMap.values()]));
    await renderSegment(assets[shot.index] ?? { kind: "motion_card", provider: "local" }, imagePath, segmentPath, shot.duration, brief);
    await applyExactOverlays(segmentPath, shot, materials, brief);
    if (shot.index === 0) posterPath = imagePath;
    segments.push(segmentPath);
    onShotRendered?.(shot.index);
  }

  const concatPath = path.join(directory, "segments.txt");
  const concatContent = segments.map((segment) => `file '${segment.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
  await fs.writeFile(concatPath, concatContent, "utf8");
  const silentVideo = path.join(directory, "visuals.mp4");
  await run(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", concatPath, "-c", "copy", silentVideo]);

  const outputPath = path.join(directory, "video.mp4");
  await run(ffmpegPath, [
    "-y", "-i", silentVideo, "-i", narrationPath,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
    "-t", String(brief.duration), "-movflags", "+faststart", outputPath
  ]);
  return { outputPath, posterPath, subtitlePath };
}

export async function inspectVideo(outputPath: string): Promise<{ duration: number; size: number }> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  const stats = await fs.stat(outputPath);
  const output = await run(ffmpegPath, ["-i", outputPath, "-f", "null", "-"]);
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
  return { duration, size: stats.size };
}
