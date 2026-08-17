import { nanoid } from "nanoid";
import { z } from "zod";
import type { DataAsset, ShotPlan, VideoBrief, VideoPlan } from "../shared/video.js";
import { VIDEO_STYLES } from "../shared/video.js";
import type { ExperienceMatch } from "./db.js";

const sentenceEnd = /(?<=[。！？!?；;])/;
const llmPlanSchema = z.object({
  title: z.string().min(2).max(40),
  hook: z.string().min(4).max(80),
  shots: z.array(z.object({
    narration: z.string().min(4).max(120),
    headline: z.string().min(2).max(30),
    visualPrompt: z.string().min(4).max(500)
  })).min(5).max(10)
});

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[“”]/g, "").trim();
}

function targetCharacters(duration: number): number {
  return Math.round(duration * 3.8);
}

function fitText(text: string, max: number): string {
  const clean = cleanText(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？"));
  return `${cut.slice(0, lastStop > max * 0.65 ? lastStop + 1 : max).replace(/[。！？!?；;，,]+$/g, "")}。`;
}

function localScript(brief: VideoBrief, dataAssets: DataAsset[]): string {
  if (brief.sourceText?.trim()) return fitText(brief.sourceText, targetCharacters(brief.duration));
  const keywords = brief.keywords.length ? brief.keywords.join("、") : "核心机制";
  const core = [
    `你可能听说过${brief.topic}，真正的答案藏在身体每天的变化里。`,
    `先抓住${keywords}这几个关键词。`,
    `它们会相互作用，影响事情的发展过程。`,
    `理解这些联系，比记住单一结论更重要。`,
    `日常可以从规律生活和观察身体信号做起。`,
    `出现持续不适时，应及时寻求专业帮助。`,
    `科普帮助理解风险，具体判断仍需结合个人情况。`
  ];
  const sentenceCount = brief.duration === 30 ? 5 : brief.duration === 45 ? 6 : 7;
  return fitText(core.slice(0, sentenceCount).join(""), targetCharacters(brief.duration));
}

function splitForShots(script: string, count: number): string[] {
  const sentences = script.split(sentenceEnd).map((item) => item.trim()).filter((item) => item.replace(/[\p{P}\p{S}]/gu, "").length > 0);
  while (sentences.length < count) {
    const longestIndex = sentences.reduce((longest, value, index, all) => value.length > all[longest].length ? index : longest, 0);
    const longest = sentences[longestIndex];
    if (longest.length < 14) break;
    const midpoint = Math.floor(longest.length / 2);
    const nearbyPunctuation = [...longest].findIndex((char, index) => index >= midpoint - 4 && /[，、；：]/.test(char));
    const splitAt = nearbyPunctuation >= midpoint - 4 ? nearbyPunctuation + 1 : midpoint;
    sentences.splice(longestIndex, 1, longest.slice(0, splitAt), longest.slice(splitAt));
  }
  const buckets = Array.from({ length: count }, () => "");
  sentences.forEach((sentence, index) => {
    const target = index < count ? index : buckets.reduce((shortest, value, idx, all) => value.length < all[shortest].length ? idx : shortest, 0);
    buckets[target] += sentence;
  });
  return buckets.filter((item) => item.replace(/[\p{P}\p{S}]/gu, "").length > 0);
}

function headline(text: string, fallback: string): string {
  const compact = text.replace(/[，。！？、；：]/g, " ").trim();
  return compact.slice(0, 14) || fallback;
}

function distributeDurations(parts: string[], total: number): number[] {
  const weights = parts.map((part) => Math.max(part.length, 8));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const values = weights.map((value) => Math.max(3.5, (value / weightTotal) * total));
  const scale = total / values.reduce((sum, value) => sum + value, 0);
  return values.map((value) => Number((value * scale).toFixed(2)));
}

interface PlannerConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  supportsJsonMode: boolean;
  disableThinking: boolean;
}

export interface PlannerStatus {
  connected: boolean;
  provider: "openai" | "deepseek" | "ark" | "local";
  model?: string;
}

export function getPlannerStatus(): PlannerStatus {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) return { connected: true, provider: "openai", model: process.env.OPENAI_MODEL };
  if (process.env.DEEPSEEK_API_KEY) return { connected: true, provider: "deepseek", model: process.env.DEEPSEEK_MODEL || "deepseek-chat" };
  if (process.env.ARK_API_KEY) return { connected: true, provider: "ark", model: process.env.ARK_TEXT_MODEL || "doubao-seed-2-1-pro-260628" };
  return { connected: false, provider: "local" };
}

function plannerConfig(): PlannerConfig | undefined {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
    return {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
      model: process.env.OPENAI_MODEL,
      supportsJsonMode: true,
      disableThinking: false
    };
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
      model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
      supportsJsonMode: true,
      disableThinking: false
    };
  }
  if (process.env.ARK_API_KEY) {
    return {
      apiKey: process.env.ARK_API_KEY,
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: process.env.ARK_TEXT_MODEL || "doubao-seed-2-1-pro-260628",
      supportsJsonMode: false,
      disableThinking: true
    };
  }
  return undefined;
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  return JSON.parse(candidate.trim());
}

function fitNarrations(narrations: string[], maximum: number): string[] {
  const total = narrations.reduce((sum, narration) => sum + narration.length, 0);
  if (total <= maximum) return narrations;
  const scale = maximum / total;
  return narrations.map((narration) => fitText(narration, Math.max(12, Math.floor(narration.length * scale))));
}

export function summarizeExperience(experience?: ExperienceMatch) {
  if (!experience) return undefined;
  return {
    title: experience.plan.title,
    hook: experience.plan.hook,
    shots: experience.plan.shots.map((shot) => ({
      headline: shot.headline,
      duration: shot.duration,
      narrationStructure: shot.narration.slice(0, 80),
      visualStructure: shot.visualPrompt.slice(0, 180)
    }))
  };
}

function applyVisualGuardrails(plan: VideoPlan, brief: VideoBrief): VideoPlan {
  const selectedStyle = VIDEO_STYLES.find((style) => style.id === brief.style);
  const styleName = selectedStyle?.name ?? "科普解说";
  const styleGuidance = selectedStyle?.promptGuidance ?? "清晰友好的科普画面";
  const safetyGuidance = "禁止血液、手术、解剖切面、病变特写和恐怖氛围";
  const continuityGuidance = "整条视频保持相同的角色外观、服装、场景设计和配色；画面内禁止任何文字、数字、图表、药品标签、钟表刻度或UI界面，信息由后期字幕叠加";
  return {
    ...plan,
    shots: plan.shots.map((shot) => ({
      ...shot,
      visualPrompt: `${styleName}，${styleGuidance}，${safetyGuidance}，${continuityGuidance}。固定角色：一位短发医生穿白大褂和蓝色衬衫，一位成年患者穿浅蓝色上衣；主题：${brief.topic}；镜头设计：${shot.visualPrompt}；主体明确，无水印，适合${brief.audience}`
    }))
  };
}

async function planWithLlm(brief: VideoBrief, dataAssets: DataAsset[], experience?: ExperienceMatch): Promise<VideoPlan | undefined> {
  const config = plannerConfig();
  if (!config) return undefined;
  const style = VIDEO_STYLES.find((item) => item.id === brief.style);
  const shotCount = Math.min(10, Math.max(5, Math.round(brief.duration / 6)));
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      max_tokens: 2000,
      ...(config.supportsJsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(config.disableThinking ? { thinking: { type: "disabled" } } : {}),
      messages: [
        {
          role: "system",
          content: `你是资深医学科普短视频编导。只输出一个合法 JSON 对象，不要解释、不要 Markdown。JSON 格式：{"title":"标题","hook":"开场钩子","shots":[{"narration":"本镜头旁白","headline":"短标题","visualPrompt":"只描述人物动作、场景和镜头"}]}。要求：旁白形成完整叙事，依次包含问题钩子、核心机制或原因、关键证据或判断、可执行建议、谨慎总结；必须具体使用用户给出的关键词，禁止“它们相互作用”等空泛套话；不得给出个体诊断、具体剂量或自行停药建议；不确定信息使用谨慎表述；医学画面友好、简化、非刺激。`
        },
        {
          role: "user",
          content: JSON.stringify({
            topic: brief.topic,
            keywords: brief.keywords,
            sourceText: brief.sourceText || undefined,
            audience: brief.audience,
            tone: brief.tone,
            style: style?.name,
            dataAssets: dataAssets.map((asset) => ({ name: asset.name, summary: asset.summary, columns: asset.columns })),
            successfulExperience: summarizeExperience(experience),
            requirements: `生成${shotCount}个镜头；中文旁白总计约${targetCharacters(brief.duration)}字，适配${brief.duration}秒；每个镜头只讲一个重点；上传数据只能做描述性表达，不推断因果。若提供 successfulExperience，复用其叙事节奏、镜头结构和有效表达方式，但不得照抄具体医学事实或原句。`
          })
        }
      ]
    }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!response.ok) throw new Error(`LLM request failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return undefined;
  const parsed = llmPlanSchema.parse(extractJson(content));
  const rawShots = parsed.shots.slice(0, shotCount);
  const rawNarrations = rawShots.map((shot, index) => cleanText(index === 0 ? parsed.hook : shot.narration));
  const narrations = fitNarrations(rawNarrations, targetCharacters(brief.duration));
  const durations = distributeDurations(narrations, brief.duration);
  return {
    title: parsed.title,
    hook: parsed.hook,
    script: narrations.join(""),
    planner: config.model,
    shots: rawShots.map((shot, index) => ({
      id: nanoid(8), index, duration: durations[index] ?? 5, narration: narrations[index],
      headline: shot.headline, visualPrompt: shot.visualPrompt,
      assetType: "motion_card", status: "pending", retryCount: 0
    }))
  };
}

function applyDataShots(plan: VideoPlan, dataAssets: DataAsset[]): VideoPlan {
  if (!dataAssets.length || !plan.shots.length) return plan;
  const shots = plan.shots.map((shot) => ({ ...shot }));
  dataAssets.slice(0, Math.min(3, shots.length)).forEach((asset, index) => {
    const targetIndex = Math.min(shots.length - 1, Math.max(1, 2 + index));
    shots[targetIndex] = {
      ...shots[targetIndex],
      headline: asset.name.replace(/\.[^.]+$/, ""),
      narration: asset.summary,
      visualPrompt: `精确展示上传数据：${asset.columns.join("、")}`,
      assetType: "data_visualization",
      dataAssetId: asset.id
    };
  });
  const totalDuration = plan.shots.reduce((sum, shot) => sum + shot.duration, 0);
  const durations = distributeDurations(shots.map((shot) => shot.narration), totalDuration);
  const timedShots = shots.map((shot, index) => ({ ...shot, duration: durations[index] }));
  return { ...plan, script: timedShots.map((shot) => shot.narration).join(""), shots: timedShots };
}

export async function createPlan(brief: VideoBrief, experience?: ExperienceMatch, dataAssets: DataAsset[] = []): Promise<VideoPlan> {
  try {
    const llmPlan = await planWithLlm(brief, dataAssets, experience);
    if (llmPlan) return applyDataShots(applyVisualGuardrails({ ...llmPlan, experienceUsed: experience?.jobId }, brief), dataAssets);
  } catch (error) {
    console.warn("LLM planner unavailable, using local planner:", error);
  }

  const script = localScript(brief, dataAssets);
  const learnedCount = experience?.plan.shots.length;
  const shotCount = Math.min(10, Math.max(5, learnedCount ?? Math.round(brief.duration / 6)));
  const parts = splitForShots(script, shotCount);
  const durations = distributeDurations(parts, brief.duration);
  const shots: ShotPlan[] = parts.map((narration, index) => ({
    id: nanoid(8),
    index,
    duration: durations[index],
    narration,
    headline: index === 0 ? brief.topic : headline(narration, `要点 ${index + 1}`),
    visualPrompt: `表现这一句旁白的核心动作：${narration}`,
    assetType: "motion_card",
    status: "pending",
    retryCount: 0
  }));
  return applyDataShots(applyVisualGuardrails({
    title: brief.topic,
    hook: shots[0]?.narration ?? brief.topic,
    script,
    shots,
    planner: "local-template",
    experienceUsed: experience?.jobId
  }, brief), dataAssets);
}
