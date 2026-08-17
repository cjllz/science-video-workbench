export const VIDEO_STYLES = [
  {
    id: "medical-documentary",
    name: "医学纪录片",
    description: "克制、可信，适合疾病和治疗机制",
    promptGuidance: "友好克制的医学科普画面，人体结构只使用柔和的简化示意模型，不展示血液、手术、解剖切面、病变特写或恐怖氛围",
    palette: ["#162321", "#d8eee8", "#f4c95d", "#f7f5ef"]
  },
  {
    id: "flat-explainer",
    name: "扁平动画科普",
    description: "清晰、亲和，适合概念和流程解释",
    promptGuidance: "明亮亲和的二维或轻三维科普动画，使用简化图形和柔和色彩，画面干净，无令人不适的医学细节",
    palette: ["#17324d", "#7bdff2", "#f7a072", "#fff8e7"]
  },
  {
    id: "news-explainer",
    name: "新闻解说",
    description: "信息密度高，适合政策和热点解读",
    promptGuidance: "克制专业的新闻解说画面，使用真实生活场景和抽象信息元素，避免夸张冲突和刺激性特写",
    palette: ["#1d1f24", "#e34a3f", "#f2c94c", "#f5f5f3"]
  },
  {
    id: "data-story",
    name: "数据图表解说",
    description: "强调数字和因果关系",
    promptGuidance: "简洁的数据叙事场景，保留充足留白，生成视频中不出现文字或数字，精确数据由后期图表渲染",
    palette: ["#102a43", "#2ec4b6", "#ffbf69", "#f8f9fa"]
  },
  {
    id: "real-life",
    name: "真实生活场景",
    description: "自然、贴近日常，适合生活健康主题",
    promptGuidance: "自然温暖的日常生活场景，人物状态健康平静，镜头舒缓，避免医疗操作和身体不适特写",
    palette: ["#263238", "#8ab17d", "#e9c46a", "#faf7f0"]
  }
] as const;

export type VideoStyleId = (typeof VIDEO_STYLES)[number]["id"];

export interface VideoBrief {
  topic: string;
  keywords: string[];
  style: VideoStyleId;
  audience: string;
  tone: string;
  duration: 15 | 30 | 45 | 60;
  aspectRatio: "3:4" | "9:16" | "16:9";
  generationMode?: "hybrid" | "all-ai";
  sourceText?: string;
  dataAssetIds?: string[];
  scriptMode?: "ai" | "provided";
}

export type DataCell = string | number | null;

export interface DataAsset {
  id: string;
  name: string;
  columns: string[];
  rows: DataCell[][];
  rowCount: number;
  numericColumns: string[];
  summary: string;
  createdAt: string;
}

export type MaterialKind = "image" | "video" | "audio" | "data";
export type MaterialRole = "subject" | "scene" | "first_frame" | "last_frame" | "replacement" | "motion" | "camera" | "music" | "voice" | "rhythm" | "data";
export type MaterialMode = "ai_reference" | "exact_overlay" | "data_chart";
export type MaterialPlacement = "full" | "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface MaterialAsset {
  id: string;
  variableName: string;
  name: string;
  kind: MaterialKind;
  mimeType: string;
  size: number;
  url: string;
  publicUrl?: string;
  dataAsset?: DataAsset;
  createdAt: string;
}

export interface MaterialChartConfig {
  type: "line" | "bar" | "table";
  xColumn: string;
  yColumns: string[];
}

export interface ShotMaterialBinding {
  materialId: string;
  variableName: string;
  role: MaterialRole;
  mode: MaterialMode;
  placement: MaterialPlacement;
  startOffset?: number;
  endOffset?: number;
  chart?: MaterialChartConfig;
}

export interface ShotPlan {
  id: string;
  index: number;
  duration: number;
  narration: string;
  headline: string;
  visualPrompt: string;
  assetType: "generated_video" | "motion_card" | "data_visualization";
  dataAssetId?: string;
  status: "pending" | "rendering" | "complete" | "failed";
  retryCount: number;
  materialBindings?: ShotMaterialBinding[];
}

export interface VideoPlan {
  title: string;
  script: string;
  hook: string;
  shots: ShotPlan[];
  planner?: string;
  experienceUsed?: string;
}

export type JobStatus = "queued" | "planning" | "awaiting_confirmation" | "narrating" | "rendering" | "quality_check" | "complete" | "failed";

export interface VideoJob {
  id: string;
  brief: VideoBrief;
  status: JobStatus;
  progress: number;
  currentStage: string;
  plan?: VideoPlan;
  outputUrl?: string;
  posterUrl?: string;
  subtitleUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedbackInput {
  accepted: boolean;
  rating: number;
  notes?: string;
}

export type RetouchVisualAction = "none" | "edit" | "regenerate";

export interface ShotRetouchInput {
  shotId: string;
  patch: Partial<Pick<ShotPlan, "headline" | "narration" | "visualPrompt" | "materialBindings">>;
  visualAction?: RetouchVisualAction;
  regenerateVisual?: boolean;
}

export interface VideoRevision {
  id: string;
  jobId: string;
  plan: VideoPlan;
  outputUrl: string;
  posterUrl?: string;
  subtitleUrl?: string;
  createdAt: string;
}
