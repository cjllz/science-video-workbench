import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { MaterialAsset, ShotPlan, VideoBrief, VideoJob, VideoPlan } from "../src/shared/video.js";
import { createJob, getJob, listMaterialAssets, recordEvent, updateJob, updateMaterialVariable } from "../src/server/db.js";
import { storeMaterialUpload } from "../src/server/materials.js";
import { outputRoot } from "../src/server/paths.js";

const SERVER = process.env.STUDIO_URL ?? "http://127.0.0.1:8787";
const SOURCE_DIRECTORY = "D:\\Users\\Desktop\\提醒新_拆分素材";
const ffmpegPath = ffmpegStatic;

const assets = [
  { variableName: "图片1", filename: "00_full_reference.png" },
  { variableName: "图片2", filename: "01_overview_标题与监测说明.png" },
  { variableName: "图片3", filename: "02_safety_line_肺功能安全线.png" },
  { variableName: "图片4", filename: "03_activity_line_炎症活跃线.png" },
  { variableName: "图片5", filename: "04_monitoring_监测指引完整.png" }
] as const;

const lines = [
  { duration: 2.5, text: "肺，也有自己的最佳状态。" },
  { duration: 2.5, text: "监测五到七天，建立安全线和活跃线。" },
  { duration: 3, text: "肺功能，别低于安全线。" },
  { duration: 3, text: "炎症指标，别高于活跃线。" },
  { duration: 4, text: "复诊带上报告，请医生评估，别自行停药或减药。" }
] as const;

const narration = lines.map((line) => line.text).join("");

const prompt = `15秒，3:4竖版，现代专业亲切的二维扁平医学卡通动画，轻微2.5D层次，白色、浅紫色、紫色和绿色配色。固定主角是一位30岁左右的中国女性呼吸科医生：短发，白大褂，浅绿色内搭；全片外貌、发型、服装、身体比例完全一致。医生有自然眨眼、点头、转身、指向和轻微说话口型。禁止任何可读文字、数字、图表、药品品牌、Logo、水印和二维码，画面中的精确信息由后期叠加。
0-2.5秒：明亮整洁的卡通呼吸科诊室，医生从左侧进入，在画面下半部面向观众微笑，身旁绿色肺部图标轻微呼吸起伏；画面上半部保留大块干净展示区。
2.5-5秒：医生抬手，身旁快速翻过一组无文字的日历卡片；红色肺部警戒图标和橙色炎症火焰图标依次出现，医生分别指向两个图标。
5-8秒：镜头稳定，医生站在左下方，身体不遮挡画面中央和上半部的大型展示区，抬手指向展示区中的一条水平警戒位置，做温和提醒手势。
8-11秒：自然转场，医生保持同一造型，在左下方转身指向同一个大型展示区，橙色火焰图标轻微缩小。
11-15秒：切回诊室，一位成年患者手持连续监测报告站在医生身旁，两人位于画面下方；上半部保留完整大型信息卡区域。医生指向报告，患者点头，最后医生面向观众做提醒手势。动作自然、人物稳定、没有手指畸形、物体穿透或换脸换装。不要血液、手术、器官病变和恐怖医学画面。`;

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${command} exited ${code}: ${output.slice(-3000)}`)));
  });
}

async function probeDuration(filePath: string): Promise<number> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  const output = await run(ffmpegPath, ["-i", filePath, "-f", "null", "-"]);
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Cannot inspect audio duration: ${filePath}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function atempoChain(factor: number): string {
  const values: number[] = [];
  while (factor > 2) {
    values.push(2);
    factor /= 2;
  }
  while (factor < 0.5) {
    values.push(0.5);
    factor /= 0.5;
  }
  values.push(factor);
  return values.map((value) => `atempo=${value.toFixed(6)}`).join(",");
}

async function ensureMaterials(): Promise<MaterialAsset[]> {
  const existing = listMaterialAssets(200);
  const result: MaterialAsset[] = [];
  for (const definition of assets) {
    const previous = existing.find((material) => material.name === definition.filename);
    if (previous) {
      result.push(previous.variableName === definition.variableName ? previous : updateMaterialVariable(previous.id, definition.variableName));
      continue;
    }
    const sourcePath = path.join(SOURCE_DIRECTORY, definition.filename);
    const stored = await storeMaterialUpload(definition.filename, "image/png", await fs.readFile(sourcePath));
    result.push(updateMaterialVariable(stored.id, definition.variableName));
  }
  return result;
}

function createVideoJob(): VideoJob {
  const now = new Date().toISOString();
  const brief = {
    topic: "肺的最佳状态：安全线与炎症活跃线",
    keywords: ["肺功能安全线", "炎症活跃线", "连续监测", "复诊评估"],
    style: "flat-explainer",
    audience: "需要连续监测肺功能和炎症指标的成年人",
    tone: "温和、专业、清晰",
    duration: 15,
    aspectRatio: "3:4",
    generationMode: "all-ai",
    sourceText: narration,
    scriptMode: "provided"
  } as unknown as VideoBrief;
  return {
    id: nanoid(12),
    brief,
    status: "awaiting_confirmation",
    progress: 100,
    currentStage: "专用分镜已准备，等待 Seedance 2.0",
    createdAt: now,
    updatedAt: now
  };
}

function createPlan(): VideoPlan {
  const shot: ShotPlan = {
    id: nanoid(8),
    index: 0,
    duration: 15,
    narration,
    headline: "肺的最佳状态",
    visualPrompt: prompt,
    assetType: "generated_video",
    status: "pending",
    retryCount: 0
  };
  return { title: "肺的最佳状态：连续监测安全线与活跃线", hook: lines[0].text, script: narration, shots: [shot], planner: "provided" };
}

async function pollSeedance(jobId: string): Promise<VideoJob> {
  const deadline = Date.now() + 12 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const response = await fetch(`${SERVER}/api/jobs/${jobId}`);
    if (!response.ok) throw new Error(`Cannot read job ${jobId}`);
    const job = await response.json() as VideoJob;
    console.log(`[${job.progress}%] ${job.currentStage}`);
    if (job.status === "complete") return job;
    if (job.status === "failed") throw new Error(job.error || job.currentStage);
  }
  throw new Error("Seedance generation timed out after 12 minutes");
}

async function waitForSeedance(jobId: string): Promise<VideoJob> {
  const queued = await fetch(`${SERVER}/api/jobs/${jobId}/render`, { method: "POST" });
  if (!queued.ok) throw new Error(`Render request failed: ${queued.status} ${await queued.text()}`);
  return pollSeedance(jobId);
}

async function renderNarration(directory: string): Promise<string> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  const rendered: string[] = [];
  for (const [index, line] of lines.entries()) {
    const rawPath = path.join(directory, `voice-raw-${index}.mp3`);
    const exactPath = path.join(directory, `voice-${index}.wav`);
    await run("python", ["-m", "edge_tts", "--voice", "zh-CN-XiaoxiaoNeural", "--rate", "+35%", "--text", line.text, "--write-media", rawPath]);
    const rawDuration = await probeDuration(rawPath);
    const speakingDuration = Math.max(1.1, line.duration - 0.18);
    const tempo = rawDuration / speakingDuration;
    await run(ffmpegPath, [
      "-y", "-i", rawPath,
      "-af", `${atempoChain(tempo)},apad=pad_dur=${line.duration},atrim=0:${line.duration},asetpts=PTS-STARTPTS`,
      "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", exactPath
    ]);
    rendered.push(exactPath);
  }
  const listPath = path.join(directory, "voice-segments.txt");
  await fs.writeFile(listPath, rendered.map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"), "utf8");
  const voicePath = path.join(directory, "narration-exact.wav");
  await run(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le", voicePath]);
  return voicePath;
}

async function renderAudio(directory: string, voicePath: string): Promise<string> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  const audioPath = path.join(directory, "audio-final.m4a");
  const filter = [
    "[0:a]volume=1[voice]",
    "[1:a]volume=0.016,afade=t=in:st=0:d=0.8,afade=t=out:st=14:d=1[m1]",
    "[2:a]volume=0.010,afade=t=in:st=0:d=0.8,afade=t=out:st=14:d=1[m2]",
    "[3:a]volume=0.055,afade=t=out:st=0.10:d=0.08,asplit=6[f1][f2][f3][f4][f5][f6]",
    "[f1]adelay=2500:all=1[a1]",
    "[f2]adelay=5000:all=1[a2]",
    "[f3]adelay=6200:all=1[a3]",
    "[f4]adelay=8000:all=1[a4]",
    "[f5]adelay=9200:all=1[a5]",
    "[f6]adelay=11000:all=1[a6]",
    "[voice][m1][m2][a1][a2][a3][a4][a5][a6]amix=inputs=9:duration=longest:normalize=0,atrim=0:15,alimiter=limit=0.95[a]"
  ].join(";");
  await run(ffmpegPath, [
    "-y", "-i", voicePath,
    "-f", "lavfi", "-i", "sine=frequency=220:duration=15:sample_rate=44100",
    "-f", "lavfi", "-i", "sine=frequency=329.63:duration=15:sample_rate=44100",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=0.18:sample_rate=44100",
    "-filter_complex", filter, "-map", "[a]", "-c:a", "aac", "-b:a", "160k", audioPath
  ]);
  return audioPath;
}

async function renderCalendarOverlay(directory: string): Promise<string> {
  const destination = path.join(directory, "calendar-overlay.png");
  const pageStack = Array.from({ length: 6 }, (_, index) => {
    const x = 72 + index * 20;
    const y = 82 - index * 8;
    return `<rect x="${x}" y="${y}" width="250" height="245" rx="18" fill="#ffffff" stroke="#dcd0ec" stroke-width="5"/>
      <rect x="${x}" y="${y}" width="250" height="48" rx="18" fill="${index === 5 ? "#7d3c98" : "#b899cb"}"/>
      <circle cx="${x + 62}" cy="${y + 102}" r="12" fill="#d7eede"/><circle cx="${x + 125}" cy="${y + 102}" r="12" fill="#d7eede"/><circle cx="${x + 188}" cy="${y + 102}" r="12" fill="#d7eede"/>
      <circle cx="${x + 62}" cy="${y + 165}" r="12" fill="#eee8f7"/><circle cx="${x + 125}" cy="${y + 165}" r="12" fill="#eee8f7"/><circle cx="${x + 188}" cy="${y + 165}" r="12" fill="#eee8f7"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" viewBox="0 0 900 420">
    <rect x="8" y="8" width="884" height="404" rx="36" fill="#fbf9ff" stroke="#e4d9f2" stroke-width="8"/>
    ${pageStack}
    <path d="M470 120 C420 105 390 155 400 220 C410 285 455 300 482 253 L492 165 C490 142 485 128 470 120Z" fill="#e36d76"/>
    <path d="M530 120 C580 105 610 155 600 220 C590 285 545 300 518 253 L508 165 C510 142 515 128 530 120Z" fill="#e36d76"/>
    <rect x="489" y="74" width="22" height="108" rx="11" fill="#c74f5a"/>
    <path d="M690 278 C642 237 671 197 705 156 C707 191 730 199 742 224 C758 191 787 178 790 139 C837 200 849 252 812 289 C777 324 718 316 690 278Z" fill="#ff8b24"/>
    <path d="M729 280 C710 258 722 235 746 209 C750 232 766 239 768 264 C783 246 794 232 795 215 C816 250 806 286 777 297 C758 305 741 297 729 280Z" fill="#ffd05b"/>
    <path d="M390 345 H610" stroke="#e34a3f" stroke-width="12" stroke-linecap="round" stroke-dasharray="22 18"/>
    <path d="M648 345 H842" stroke="#ff8b24" stroke-width="12" stroke-linecap="round" stroke-dasharray="22 18"/>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(destination);
  return destination;
}

async function renderVisuals(directory: string): Promise<string> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  const providerPath = path.join(directory, "provider-0.mp4");
  await fs.access(providerPath);
  const image2 = path.join(SOURCE_DIRECTORY, assets[1].filename);
  const image3 = path.join(SOURCE_DIRECTORY, assets[2].filename);
  const image4 = path.join(SOURCE_DIRECTORY, assets[3].filename);
  const image5 = path.join(SOURCE_DIRECTORY, assets[4].filename);
  const calendarOverlay = await renderCalendarOverlay(directory);
  const visualPath = path.join(directory, "visuals-final.mp4");
  const filter = [
    "[0:v]scale=1080:1440:force_original_aspect_ratio=increase,crop=1080:1440,setsar=1,fps=30[base0]",
    "[base0]drawbox=x=30:y=70:w=1020:h=550:color=0xf4f0fb@1:t=fill:enable='between(t,0,11)'[base]",
    "[1:v]scale=900:-2,format=rgba,fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st=2.2:d=0.3:alpha=1,setpts=PTS-STARTPTS+2.5/TB[calendar]",
    "[2:v]scale=950:-2,format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=2.2:d=0.3:alpha=1,setpts=PTS-STARTPTS[c2]",
    "[3:v]scale=1010:-2,format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=2.7:d=0.3:alpha=1,setpts=PTS-STARTPTS+5/TB[c3]",
    "[4:v]scale=1010:-2,format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st=2.7:d=0.3:alpha=1,setpts=PTS-STARTPTS+8/TB[c4]",
    "[5:v]scale=680:-2,format=rgba,fade=t=out:st=3.7:d=0.3:alpha=1,setpts=PTS-STARTPTS+11/TB[c5]",
    "[base][c2]overlay=65:115:enable='between(t,0,2.5)':eof_action=pass[v1]",
    "[v1][calendar]overlay=90:105:enable='between(t,2.5,5)':eof_action=pass[v2]",
    "[v2][c3]overlay=35:120:enable='between(t,5,8)':eof_action=pass[v3]",
    "[v3]drawbox=x=205:y=284:w=735:h=13:color=red@0.24:t=fill:enable='between(t,6.15,6.55)'[v4]",
    "[v4][c4]overlay=35:120:enable='between(t,8,11)':eof_action=pass[v5]",
    "[v5]drawbox=x=205:y=284:w=735:h=13:color=red@0.24:t=fill:enable='between(t,9.15,9.55)'[v6]",
    "[v6]drawbox=x=100:y=80:w=100:h=440:color=0xf7f2ff@0.96:t=fill:enable='between(t,11,15)'[v6a]",
    "[v6a]drawbox=x=880:y=80:w=100:h=440:color=0xf7f2ff@0.96:t=fill:enable='between(t,11,15)'[v6b]",
    "[v6b][c5]overlay=200:10:enable='between(t,11,15)':eof_action=pass[v7]",
    "[v7]drawbox=x=205:y='20+(t-11)*118':w=670:h=120:color=0x7d3c98@0.12:t=fill:enable='between(t,11.2,14.3)',format=yuv420p[v]"
  ].join(";");
  await run(ffmpegPath, [
    "-y", "-i", providerPath,
    "-loop", "1", "-framerate", "30", "-i", calendarOverlay,
    "-loop", "1", "-framerate", "30", "-i", image2,
    "-loop", "1", "-framerate", "30", "-i", image3,
    "-loop", "1", "-framerate", "30", "-i", image4,
    "-loop", "1", "-framerate", "30", "-i", image5,
    "-filter_complex", filter, "-map", "[v]", "-an", "-t", "15", "-r", "30",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", visualPath
  ]);
  return visualPath;
}

function srtTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const ms = milliseconds % 1000;
  return `00:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

async function finalize(directory: string, visualPath: string, audioPath: string): Promise<void> {
  if (!ffmpegPath) throw new Error("Bundled ffmpeg is unavailable");
  const temporaryOutput = path.join(directory, "video-final.mp4");
  const outputPath = path.join(directory, "video.mp4");
  const posterPath = path.join(directory, "poster-final.png");
  await run(ffmpegPath, [
    "-y", "-i", visualPath, "-i", audioPath,
    "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-t", "15", "-movflags", "+faststart", temporaryOutput
  ]);
  await fs.rm(outputPath, { force: true });
  await fs.rename(temporaryOutput, outputPath);
  await run(ffmpegPath, ["-y", "-ss", "0.8", "-i", outputPath, "-frames:v", "1", posterPath]);
  let cursor = 0;
  const captions = lines.map((line, index) => {
    const start = cursor;
    cursor += line.duration;
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${line.text}\n`;
  }).join("\n");
  await fs.writeFile(path.join(directory, "captions.srt"), captions, "utf8");
}

async function main(): Promise<void> {
  const health = await fetch(`${SERVER}/api/health`);
  if (!health.ok) throw new Error(`Studio server is unavailable at ${SERVER}`);
  const storedMaterials = await ensureMaterials();
  const resumeIndex = process.argv.indexOf("--resume");
  const resumeId = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : undefined;
  let job: VideoJob;
  if (resumeId) {
    const existing = getJob(resumeId);
    if (!existing) throw new Error(`Cannot resume missing job ${resumeId}`);
    job = existing;
    console.log(`RESUME_JOB_ID=${job.id}`);
    if (job.status !== "complete") await pollSeedance(job.id);
  } else {
    job = createVideoJob();
    const plan = createPlan();
    createJob(job);
    updateJob(job.id, { plan });
    recordEvent(job.id, "custom.materials.attached", { materialIds: storedMaterials.map((material) => material.id), variables: storedMaterials.map((material) => material.variableName) });
    console.log(`JOB_ID=${job.id}`);
    await waitForSeedance(job.id);
  }

  const directory = path.join(outputRoot, job.id);
  updateJob(job.id, { status: "rendering", progress: 94, currentStage: "正在精确合成医学图表、旁白和提示音" });
  const voicePath = await renderNarration(directory);
  const [audioPath, visualPath] = await Promise.all([renderAudio(directory, voicePath), renderVisuals(directory)]);
  await finalize(directory, visualPath, audioPath);
  recordEvent(job.id, "custom.composite.completed", { ratio: "3:4", duration: 15, resolution: "1080x1440", materials: storedMaterials.map((material) => material.variableName) });
  const currentPlan = getJob(job.id)?.plan ?? createPlan();
  const overlayTimeline = [
    { material: storedMaterials[1], startOffset: 0, endOffset: 2.5 },
    { material: storedMaterials[2], startOffset: 5, endOffset: 8 },
    { material: storedMaterials[3], startOffset: 8, endOffset: 11 },
    { material: storedMaterials[4], startOffset: 11, endOffset: 15 }
  ];
  const finalPlan: VideoPlan = {
    ...currentPlan,
    shots: currentPlan.shots.map((shot, index) => index === 0 ? {
      ...shot,
      materialBindings: overlayTimeline.map(({ material, startOffset, endOffset }) => ({
        materialId: material.id,
        variableName: material.variableName,
        role: "replacement",
        mode: "exact_overlay",
        placement: "full",
        startOffset,
        endOffset
      }))
    } : shot)
  };
  updateJob(job.id, {
    status: "complete",
    progress: 100,
    currentStage: "视频已生成（Seedance 2.0 + 原图精确合成）",
    outputUrl: `/outputs/${job.id}/video.mp4`,
    posterUrl: `/outputs/${job.id}/poster-final.png`,
    subtitleUrl: `/outputs/${job.id}/captions.srt`,
    plan: finalPlan,
    error: undefined
  });
  console.log(`OUTPUT=${path.join(directory, "video.mp4")}`);
  console.log(`WORKBENCH=${SERVER}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
