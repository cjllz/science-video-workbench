import { useEffect, useRef, useState } from "react";
import {
  Check, ChevronRight, Clock3, Download, Film, History, LoaderCircle,
  MessageSquareText, Play, Sparkles, Table2, ThumbsDown, ThumbsUp, Upload, WandSparkles, X
} from "lucide-react";
import { VIDEO_STYLES, type DataAsset, type DataCell, type MaterialAsset, type VideoBrief, type VideoJob } from "../shared/video";
import { api, type LearningStats, type ProviderStatus } from "./api";
import { ScriptWorkspace } from "./ScriptWorkspace";
import { RetouchWorkspace } from "./RetouchWorkspace";

const defaultBrief: VideoBrief = {
  topic: "",
  keywords: [],
  style: "flat-explainer",
  audience: "普通成年人",
  tone: "清晰、可信",
  duration: 45,
  aspectRatio: "9:16",
  generationMode: "hybrid",
  sourceText: "",
  dataAssetIds: [],
  scriptMode: "ai"
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusLabel(job: VideoJob): string {
  if (job.status === "complete") return "已完成";
  if (job.status === "failed") return "失败";
  if (job.status === "queued") return "排队中";
  if (job.status === "awaiting_confirmation") return "待确认剧本";
  return "生成中";
}

function formatDataCell(value: DataCell, column: string): string {
  if (value === null) return "-";
  if (typeof value !== "number") return value;
  if ((column.includes("率") || column.includes("%") || column.includes("占比")) && Math.abs(value) <= 1) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString();
}

function providerLabel(provider: ProviderStatus): string {
  if (!provider.connected) return "本地生成服务";
  if (provider.model?.includes("seedance-2-0-mini")) return "Seedance 2.0 Mini";
  if (provider.model?.includes("seedance-2-0")) return "Seedance 2.0";
  if (provider.model?.includes("seedance-1-0-pro")) return "Seedance 1.0 Pro";
  return "AI 视频服务";
}

function BriefForm({ disabled, provider, onCreate }: { disabled: boolean; provider: ProviderStatus; onCreate: (brief: VideoBrief) => Promise<void> }) {
  const [brief, setBrief] = useState(defaultBrief);
  const [keywordText, setKeywordText] = useState("");
  const [dataAssets, setDataAssets] = useState<DataAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLInputElement>(null);

  async function importScript(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const imported = await api.importScript(file);
      setBrief((current) => ({ ...current, sourceText: imported.text, scriptMode: "provided" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "剧本导入失败");
    } finally {
      setUploading(false);
    }
  }

  async function uploadData(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (dataAssets.length >= 3) {
      setError("每条视频最多使用 3 份数据素材");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const asset = await api.uploadDataAsset(file);
      setDataAssets((current) => [...current, asset]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "数据上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (brief.topic.trim().length < 2) {
      setError("请先输入至少两个字的主题");
      return;
    }
    setError("");
    await onCreate({
      ...brief,
      topic: brief.topic.trim(),
      keywords: keywordText.split(/[，,、\s]+/).map((item) => item.trim()).filter(Boolean),
      sourceText: brief.sourceText?.trim() || undefined,
      dataAssetIds: dataAssets.map((asset) => asset.id)
    });
  }

  return (
    <form className="brief-form" onSubmit={submit}>
      <div className="section-title">
        <span className="step-index">01</span>
        <div><h2>定义视频</h2><p>输入最少信息，自动生成完整短片</p></div>
      </div>

      <label className="field">
        <span>主题</span>
        <input value={brief.topic} onChange={(event) => setBrief({ ...brief, topic: event.target.value })} placeholder="例如：高血压为什么要长期管理" maxLength={80} />
      </label>

      <label className="field">
        <span>关键词</span>
        <input value={keywordText} onChange={(event) => setKeywordText(event.target.value)} placeholder="血压、血管、长期管理" />
        <small>用逗号或空格分隔</small>
      </label>

      <div className="field">
        <span>视频风格</span>
        <div className="style-grid">
          {VIDEO_STYLES.map((style) => (
            <button key={style.id} type="button" className={`style-option ${brief.style === style.id ? "selected" : ""}`} onClick={() => setBrief({ ...brief, style: style.id })}>
              <i style={{ background: style.palette[2] }} />
              <span><strong>{style.name}</strong><small>{style.description}</small></span>
              {brief.style === style.id && <Check size={16} />}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <span>时长</span>
          <div className="segmented">
            {[30, 45, 60].map((duration) => <button type="button" key={duration} className={brief.duration === duration ? "active" : ""} onClick={() => setBrief({ ...brief, duration: duration as 30 | 45 | 60 })}>{duration}s</button>)}
          </div>
        </div>
        <div className="field">
          <span>画幅</span>
          <div className="segmented">
            <button type="button" className={brief.aspectRatio === "9:16" ? "active" : ""} onClick={() => setBrief({ ...brief, aspectRatio: "9:16" })}>竖屏</button>
            <button type="button" className={brief.aspectRatio === "16:9" ? "active" : ""} onClick={() => setBrief({ ...brief, aspectRatio: "16:9" })}>横屏</button>
          </div>
        </div>
      </div>

      <div className="field">
        <span>生成方式</span>
        <div className="generation-modes">
          <button type="button" className={brief.generationMode === "hybrid" ? "selected" : ""} onClick={() => setBrief({ ...brief, generationMode: "hybrid" })}>
            <strong>混合生成</strong><small>3 个 AI 镜头，其余使用动画和图表</small>
          </button>
          <button type="button" className={brief.generationMode === "all-ai" ? "selected" : ""} onClick={() => setBrief({ ...brief, generationMode: "all-ai" })}>
            <strong>全 AI 镜头</strong><small>所有普通分镜调用 Seedance</small>
          </button>
        </div>
      </div>

      <div className="field">
        <span>剧本来源</span>
        <div className="segmented">
          <button type="button" className={brief.scriptMode === "ai" ? "active" : ""} onClick={() => setBrief({ ...brief, scriptMode: "ai" })}>AI 辅助生成</button>
          <button type="button" className={brief.scriptMode === "provided" ? "active" : ""} onClick={() => setBrief({ ...brief, scriptMode: "provided" })}>使用已有文案</button>
        </div>
      </div>

      {brief.scriptMode === "provided" && <label className="field script-source-field">
        <span>已有文案</span>
        <textarea value={brief.sourceText} onChange={(event) => setBrief({ ...brief, sourceText: event.target.value })} placeholder="粘贴文案，或导入 TXT、Markdown、DOCX 文件" maxLength={30000} rows={7} />
        <input ref={scriptInput} className="visually-hidden" type="file" accept=".txt,.md,.docx" onChange={importScript} />
        <button className="secondary-action import-script" type="button" disabled={uploading} onClick={() => scriptInput.current?.click()}><Upload size={16} />导入剧本文件</button>
      </label>}

      <div className="field data-upload-field">
        <span>数据素材 <em>可选</em></span>
        <input ref={fileInput} className="visually-hidden" type="file" accept=".csv,.xlsx" onChange={uploadData} />
        <button className="upload-zone" type="button" disabled={uploading || dataAssets.length >= 3} onClick={() => fileInput.current?.click()}>
          {uploading ? <LoaderCircle className="spin" size={20} /> : <Upload size={20} />}
          <span><strong>{uploading ? "正在解析数据" : "上传 Excel 或 CSV"}</strong><small>系统会将数据自动插入图表分镜</small></span>
        </button>
        {dataAssets.map((asset) => (
          <div className="data-asset" key={asset.id}>
            <div className="data-asset-heading">
              <Table2 size={18} />
              <span><strong>{asset.name}</strong><small>{asset.rowCount} 条记录 · {asset.columns.length} 个字段</small></span>
              <button type="button" title="移除数据素材" onClick={() => setDataAssets((current) => current.filter((item) => item.id !== asset.id))}><X size={16} /></button>
            </div>
            <div className="data-preview">
              <table><thead><tr>{asset.columns.slice(0, 4).map((column) => <th key={column}>{column}</th>)}</tr></thead>
                <tbody>{asset.rows.slice(0, 3).map((row, rowIndex) => <tr key={rowIndex}>{asset.columns.slice(0, 4).map((column, columnIndex) => <td key={columnIndex}>{formatDataCell(row[columnIndex] ?? null, column)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <p>{asset.summary}</p>
          </div>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      <button className="primary-action" disabled={disabled || uploading} type="submit">
        {disabled ? <LoaderCircle className="spin" size={19} /> : <WandSparkles size={19} />}
        {disabled ? "当前任务处理中" : "生成剧本"}
      </button>
      <p className="generation-policy">
        {provider.planner?.connected ? `脚本由 ${provider.planner.provider === "deepseek" ? "DeepSeek" : provider.planner.model} 生成；` : "脚本使用本地模板；"}
        {provider.connected
          ? brief.generationMode === "all-ai"
            ? "所有普通镜头都将调用 Seedance；上传数据仍使用精确图表。"
            : `每条视频最多使用 ${provider.maxGeneratedShots} 个 Seedance 镜头，其余镜头自动使用动画或图表。`
          : "当前使用本地动画模式；连接视频模型后会自动生成真实镜头。"}
      </p>
    </form>
  );
}

function EmptyPreview() {
  return (
    <div className="empty-preview">
      <div className="preview-mark"><Play size={28} fill="currentColor" /></div>
      <h2>等待第一个主题</h2>
      <p>完成左侧设置后，这里会显示分镜、实时进度和成片。</p>
    </div>
  );
}

interface JobPreviewProps {
  job: VideoJob;
  materials: MaterialAsset[];
  onMaterialAdded: (material: MaterialAsset) => void;
  onMaterialRenamed: (material: MaterialAsset) => void;
  onJobUpdated: (job: VideoJob) => void;
  onError: (message: string) => void;
  onFeedback: () => void;
}

function JobPreview({ job, materials, onMaterialAdded, onMaterialRenamed, onJobUpdated, onError, onFeedback }: JobPreviewProps) {
  const finished = job.status === "complete";
  const failed = job.status === "failed";
  const videoRef = useRef<HTMLVideoElement>(null);

  function seekVideo(seconds: number) {
    if (!videoRef.current) return;
    videoRef.current.currentTime = seconds;
    void videoRef.current.play().catch(() => undefined);
  }
  return (
    <div className="job-preview">
      <div className="job-heading">
        <div>
          <span className={`status-pill ${job.status}`}>{statusLabel(job)}</span>
          <h1>{job.plan?.title || job.brief.topic}</h1>
          <p>{job.currentStage}</p>
        </div>
        <span className="job-time"><Clock3 size={14} /> {formatDate(job.createdAt)}</span>
      </div>

      {!finished && !failed && job.status !== "awaiting_confirmation" && (
        <div className="progress-block">
          <div className="progress-meta"><span>自动生成进度</span><strong>{job.progress}%</strong></div>
          <div className="progress-track"><i style={{ width: `${job.progress}%` }} /></div>
          <div className="processing-line"><LoaderCircle className="spin" size={16} /> 正在后台完成脚本、旁白和镜头合成</div>
        </div>
      )}

      {failed && <div className="failure-box"><strong>本次生成没有完成</strong><p>{job.error}</p></div>}

      {job.outputUrl && (
        <>
          <div className={`video-shell ${job.brief.aspectRatio === "16:9" ? "landscape" : job.brief.aspectRatio === "3:4" ? "portrait-short" : "portrait"}`}>
            <video ref={videoRef} controls poster={job.posterUrl ? `${job.posterUrl}?v=${encodeURIComponent(job.updatedAt)}` : undefined} src={`${job.outputUrl}?v=${encodeURIComponent(job.updatedAt)}`} preload="metadata" />
          </div>
          <div className="output-actions">
            <a className="secondary-action" href={job.outputUrl} download><Download size={17} /> 下载 MP4</a>
            {job.subtitleUrl && <a className="text-action" href={job.subtitleUrl} download>下载字幕</a>}
            {finished && <button className="feedback-action" onClick={onFeedback}><MessageSquareText size={17} /> 评价结果</button>}
          </div>
        </>
      )}

      {job.status === "awaiting_confirmation" && job.plan && <ScriptWorkspace job={job} materials={materials} onMaterialAdded={onMaterialAdded} onMaterialRenamed={onMaterialRenamed} onJobUpdated={onJobUpdated} onError={onError} />}

      {job.outputUrl && job.plan && <RetouchWorkspace job={job} materials={materials} onMaterialAdded={onMaterialAdded} onJobUpdated={onJobUpdated} onError={onError} onSeek={seekVideo} />}

      {job.plan && job.status !== "awaiting_confirmation" && !job.outputUrl && (
        <div className="storyboard">
          <div className="section-title compact">
            <span className="step-index">02</span>
            <div><h2>自动分镜</h2><p>{job.plan.shots.length} 个镜头 · {job.brief.duration} 秒以内 · {job.plan.planner === "local-template" ? "本地脚本" : "AI 脚本"}</p></div>
          </div>
          <div className="shot-list">
            {job.plan.shots.map((shot) => (
              <div className="shot-row" key={shot.id}>
                <span className="shot-number">{String(shot.index + 1).padStart(2, "0")}</span>
                <div><strong>{shot.headline}</strong><p>{shot.narration}</p></div>
                <span className="shot-duration">{shot.duration.toFixed(1)}s</span>
              </div>
            ))}
          </div>
          {job.plan.experienceUsed && <div className="experience-note"><Sparkles size={16} /> 本次已复用历史高分视频经验</div>}
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ jobs, selectedId, stats, onSelect }: { jobs: VideoJob[]; selectedId?: string; stats: LearningStats; onSelect: (job: VideoJob) => void }) {
  return (
    <aside className="history-panel">
      <div className="history-heading"><History size={18} /><h2>生成记录</h2></div>
      <div className="learning-strip">
        <div><strong>{stats.completed}</strong><span>已生成</span></div>
        <div><strong>{stats.accepted}</strong><span>已采纳</span></div>
        <div><strong>{stats.averageRating || "-"}</strong><span>平均分</span></div>
      </div>
      <div className="history-list">
        {jobs.length === 0 && <p className="history-empty">生成记录会保存在这里</p>}
        {jobs.map((job) => (
          <button key={job.id} className={`history-row ${selectedId === job.id ? "selected" : ""}`} onClick={() => onSelect(job)}>
            <span className={`history-state ${job.status}`}><Film size={15} /></span>
            <span><strong>{job.brief.topic}</strong><small>{formatDate(job.createdAt)} · {statusLabel(job)}</small></span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    </aside>
  );
}

function FeedbackDialog({ job, onClose, onSaved }: { job: VideoJob; onClose: () => void; onSaved: (stats: LearningStats) => void }) {
  const [rating, setRating] = useState(4);
  const [accepted, setAccepted] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await api.submitFeedback(job.id, { accepted, rating, notes: notes.trim() || undefined });
      onSaved(result.stats);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="feedback-dialog" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <span className="dialog-kicker">帮助系统积累经验</span>
        <h2>这条视频可以直接使用吗？</h2>
        <div className="accept-toggle">
          <button className={accepted ? "active" : ""} onClick={() => setAccepted(true)}><ThumbsUp size={18} /> 可以使用</button>
          <button className={!accepted ? "active negative" : ""} onClick={() => setAccepted(false)}><ThumbsDown size={18} /> 需要重做</button>
        </div>
        <label className="field"><span>整体评分</span><div className="rating-row">{[1, 2, 3, 4, 5].map((value) => <button key={value} className={rating === value ? "active" : ""} onClick={() => setRating(value)}>{value}</button>)}</div></label>
        <label className="field"><span>修改意见 <em>可选</em></span><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="例如：第二个镜头太抽象，旁白节奏偏快" /></label>
        <div className="dialog-actions"><button className="text-action" onClick={onClose}>取消</button><button className="primary-action compact-action" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}保存反馈</button></div>
      </div>
    </div>
  );
}

export function App() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [selected, setSelected] = useState<VideoJob>();
  const [stats, setStats] = useState<LearningStats>({ completed: 0, accepted: 0, averageRating: 0 });
  const [provider, setProvider] = useState<ProviderStatus>({ connected: false, provider: "local", maxGeneratedShots: 0 });
  const [materials, setMaterials] = useState<MaterialAsset[]>([]);
  const [error, setError] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const generating = selected && !["complete", "failed", "awaiting_confirmation"].includes(selected.status);

  useEffect(() => {
    Promise.all([api.listJobs(), api.getStats(), api.getProvider(), api.listMaterials()]).then(([loadedJobs, loadedStats, loadedProvider, loadedMaterials]) => {
      setJobs(loadedJobs);
      setStats(loadedStats);
      setProvider(loadedProvider);
      setMaterials(loadedMaterials);
      if (loadedJobs[0]) setSelected(loadedJobs[0]);
    }).catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!selected || ["complete", "failed", "awaiting_confirmation"].includes(selected.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const updated = await api.getJob(selected.id);
        setSelected(updated);
        setJobs((current) => current.map((job) => job.id === updated.id ? updated : job));
        if (updated.status === "complete") setStats(await api.getStats());
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "读取生成进度失败");
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.status]);

  async function create(brief: VideoBrief) {
    setError("");
    try {
      const job = await api.createJob(brief);
      setSelected(job);
      setJobs((current) => [job, ...current]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建视频失败");
    }
  }

  function updateJob(job: VideoJob) {
    setSelected(job);
    setJobs((current) => current.map((item) => item.id === job.id ? job : item));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><Sparkles size={19} /></div>
        <div className="brand-copy"><strong>科普视频工作台</strong><span>自动生成 · 经验沉淀</span></div>
        <div className={`system-status ${provider.connected ? "connected" : ""}`}><i /> {providerLabel(provider)}</div>
      </header>
      {error && <div className="global-error">{error}<button onClick={() => setError("")}>关闭</button></div>}
      <main className="workspace">
        <section className="brief-panel"><BriefForm disabled={Boolean(generating)} provider={provider} onCreate={create} /></section>
        <section className="preview-panel">{selected ? <JobPreview job={selected} materials={materials} onMaterialAdded={(material) => setMaterials((current) => [material, ...current])} onMaterialRenamed={(material) => setMaterials((current) => current.map((item) => item.id === material.id ? material : item))} onJobUpdated={updateJob} onError={setError} onFeedback={() => setFeedbackOpen(true)} /> : <EmptyPreview />}</section>
        <HistoryPanel jobs={jobs} selectedId={selected?.id} stats={stats} onSelect={setSelected} />
      </main>
      {feedbackOpen && selected && <FeedbackDialog job={selected} onClose={() => setFeedbackOpen(false)} onSaved={(nextStats) => { setStats(nextStats); setFeedbackOpen(false); }} />}
    </div>
  );
}
