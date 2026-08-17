import type { DataAsset, FeedbackInput, MaterialAsset, ShotRetouchInput, VideoBrief, VideoJob, VideoPlan, VideoRevision } from "../shared/video";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: "请求失败" })) as { message?: string; issues?: Array<{ message?: string }> };
    const issueText = body.issues?.map((issue) => issue.message).filter(Boolean).join("；");
    throw new Error([body.message || `请求失败：${response.status}`, issueText].filter(Boolean).join("："));
  }
  return response.json() as Promise<T>;
}

export interface LearningStats {
  completed: number;
  accepted: number;
  averageRating: number;
}

export interface ProviderStatus {
  connected: boolean;
  provider: "ark" | "http" | "local";
  model?: string;
  maxGeneratedShots: number;
  planner?: {
    connected: boolean;
    provider: "openai" | "deepseek" | "ark" | "local";
    model?: string;
  };
}

export const api = {
  getSession: () => request<{ authRequired: boolean; authenticated: boolean }>("/api/auth/session"),
  login: (password: string) => request<{ authenticated: true }>("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  listJobs: () => request<VideoJob[]>("/api/jobs"),
  getJob: (id: string) => request<VideoJob>(`/api/jobs/${id}`),
  createJob: (brief: VideoBrief) => request<VideoJob>("/api/jobs", { method: "POST", body: JSON.stringify(brief) }),
  savePlan: (id: string, plan: VideoPlan) => request<VideoJob>(`/api/jobs/${id}/plan`, { method: "PATCH", body: JSON.stringify(plan) }),
  renderJob: (id: string) => request<VideoJob>(`/api/jobs/${id}/render`, { method: "POST" }),
  retouchJob: (id: string, input: ShotRetouchInput) => request<VideoJob>(`/api/jobs/${id}/retouch`, { method: "POST", body: JSON.stringify(input) }),
  listRevisions: (id: string) => request<VideoRevision[]>(`/api/jobs/${id}/revisions`),
  restoreRevision: (jobId: string, revisionId: string) => request<VideoJob>(`/api/jobs/${jobId}/revisions/${revisionId}/restore`, { method: "POST" }),
  listMaterials: () => request<MaterialAsset[]>("/api/materials"),
  renameMaterial: (id: string, variableName: string) => request<MaterialAsset>(`/api/materials/${id}`, { method: "PATCH", body: JSON.stringify({ variableName }) }),
  importScript: (file: File) => uploadFile<{ name: string; text: string }>("/api/script-imports", file, "剧本导入失败"),
  uploadMaterial: (file: File) => uploadFile<MaterialAsset>("/api/materials", file, "素材上传失败"),
  submitFeedback: (id: string, feedback: FeedbackInput) => request<{ ok: boolean; stats: LearningStats }>(`/api/jobs/${id}/feedback`, { method: "POST", body: JSON.stringify(feedback) }),
  getStats: () => request<LearningStats>("/api/stats"),
  getProvider: () => request<ProviderStatus>("/api/provider"),
  uploadDataAsset: async (file: File): Promise<DataAsset> => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/uploads", { method: "POST", body: form });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ message: "数据上传失败" })) as { message?: string };
      throw new Error(body.message || "数据上传失败");
    }
    return response.json() as Promise<DataAsset>;
  }
};

async function uploadFile<T>(url: string, file: File, fallback: string): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(url, { method: "POST", body: form });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: fallback })) as { message?: string };
    throw new Error(body.message || fallback);
  }
  return response.json() as Promise<T>;
}
