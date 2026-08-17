import { useEffect, useRef, useState } from "react";
import { Clock3, FileAudio, FileVideo, History, LoaderCircle, Plus, RefreshCw, Repeat2, RotateCcw, SlidersHorizontal, Table2, Trash2, Upload, WandSparkles } from "lucide-react";
import type { MaterialAsset, MaterialPlacement, RetouchVisualAction, ShotMaterialBinding, ShotPlan, VideoJob, VideoRevision } from "../shared/video";
import { api } from "./api";
import { applyMaterialPurpose, createDefaultBinding, getMaterialPurpose, getMaterialPurposeOptions, replaceBindingMaterial, type MaterialPurpose } from "./material-bindings";

interface Props {
  job: VideoJob;
  materials: MaterialAsset[];
  onMaterialAdded: (material: MaterialAsset) => void;
  onJobUpdated: (job: VideoJob) => void;
  onError: (message: string) => void;
  onSeek: (seconds: number) => void;
}

const placementOptions: Array<[MaterialPlacement, string]> = [["full", "全画面"], ["center", "居中"], ["top-left", "左上"], ["top-right", "右上"], ["bottom-left", "左下"], ["bottom-right", "右下"]];

function shotRange(shots: ShotPlan[], index: number): { start: number; end: number } {
  const start = shots.slice(0, index).reduce((sum, shot) => sum + shot.duration, 0);
  return { start, end: start + shots[index].duration };
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

function materialIcon(material: MaterialAsset) {
  if (material.kind === "image") return <img src={material.url} alt="" />;
  if (material.kind === "video") return <FileVideo size={17} />;
  if (material.kind === "audio") return <FileAudio size={17} />;
  return <Table2 size={17} />;
}

export function RetouchWorkspace({ job, materials, onMaterialAdded, onJobUpdated, onError, onSeek }: Props) {
  const shots = job.plan!.shots;
  const [selectedId, setSelectedId] = useState(shots[0]?.id ?? "");
  const selectedIndex = Math.max(0, shots.findIndex((shot) => shot.id === selectedId));
  const selected = shots[selectedIndex];
  const [draft, setDraft] = useState<ShotPlan>(() => structuredClone(selected));
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [submittingAction, setSubmittingAction] = useState<RetouchVisualAction>();
  const [uploading, setUploading] = useState(false);
  const [revisions, setRevisions] = useState<VideoRevision[]>([]);
  const uploadInput = useRef<HTMLInputElement>(null);
  const editable = job.status === "complete";
  const canRestore = job.status === "complete" || job.status === "failed";
  const range = shotRange(shots, selectedIndex);

  useEffect(() => {
    const current = job.plan!.shots.find((shot) => shot.id === selectedId) ?? job.plan!.shots[0];
    if (current) setDraft(structuredClone(current));
  }, [job.updatedAt, selectedId]);

  useEffect(() => {
    void api.listRevisions(job.id).then(setRevisions).catch(() => undefined);
  }, [job.id, job.updatedAt]);

  function updateBinding(index: number, patch: Partial<ShotMaterialBinding>) {
    setDraft((current) => ({
      ...current,
      materialBindings: (current.materialBindings ?? []).map((binding, itemIndex) => itemIndex === index ? { ...binding, ...patch } : binding)
    }));
  }

  function addMaterial(material: MaterialAsset) {
    setDraft((current) => {
      const bindings = current.materialBindings ?? [];
      if (bindings.some((binding) => binding.materialId === material.id)) return current;
      const mention = `@${material.variableName}`;
      return {
        ...current,
        visualPrompt: current.visualPrompt.includes(mention) ? current.visualPrompt : `${current.visualPrompt.trim()}，使用 ${mention}`,
        materialBindings: [...bindings, createDefaultBinding(material, current.duration)]
      };
    });
    setSelectedMaterialId("");
  }

  function replaceMaterial(index: number, material: MaterialAsset) {
    setDraft((current) => {
      const previous = (current.materialBindings ?? [])[index];
      if (!previous) return current;
      const next = replaceBindingMaterial(previous, material);
      return {
        ...current,
        visualPrompt: current.visualPrompt.replaceAll(`@${previous.variableName}`, `@${material.variableName}`),
        materialBindings: (current.materialBindings ?? []).map((binding, itemIndex) => itemIndex === index ? next : binding)
      };
    });
  }

  function removeMaterial(index: number) {
    setDraft((current) => {
      const removed = (current.materialBindings ?? [])[index];
      return {
        ...current,
        visualPrompt: removed ? current.visualPrompt.replaceAll(`@${removed.variableName}`, removed.variableName) : current.visualPrompt,
        materialBindings: (current.materialBindings ?? []).filter((_, itemIndex) => itemIndex !== index)
      };
    });
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const material = await api.uploadMaterial(file);
      onMaterialAdded(material);
      addMaterial(material);
    } catch (error) {
      onError(error instanceof Error ? error.message : "素材上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function submit(visualAction: RetouchVisualAction) {
    setSubmittingAction(visualAction);
    try {
      const updated = await api.retouchJob(job.id, {
        shotId: selected.id,
        visualAction,
        patch: { headline: draft.headline, narration: draft.narration, visualPrompt: draft.visualPrompt, materialBindings: draft.materialBindings }
      });
      onJobUpdated(updated);
    } catch (error) {
      onError(error instanceof Error ? error.message : "镜头微调提交失败");
    } finally {
      setSubmittingAction(undefined);
    }
  }

  async function restore(revision: VideoRevision) {
    setSubmittingAction("none");
    try {
      onJobUpdated(await api.restoreRevision(job.id, revision.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : "版本回退失败");
    } finally {
      setSubmittingAction(undefined);
    }
  }

  return (
    <section className="retouch-workspace">
      <div className="retouch-heading">
        <div><WandSparkles size={17} /><span><strong>镜头微调</strong><small>连续片段，不是单帧</small></span></div>
        {!editable && <span className="retouch-busy"><LoaderCircle className="spin" size={14} />正在处理修订版本</span>}
      </div>

      <div className="shot-timeline" aria-label="镜头时间线">
        {shots.map((shot, index) => {
          const itemRange = shotRange(shots, index);
          return <button key={shot.id} className={shot.id === selected.id ? "active" : ""} style={{ flexGrow: shot.duration }} onClick={() => { setSelectedId(shot.id); onSeek(itemRange.start); }}><strong>{String(index + 1).padStart(2, "0")}</strong><span>{formatSeconds(itemRange.start)}-{formatSeconds(itemRange.end)}</span></button>;
        })}
      </div>

      <div className="retouch-editor">
        <div className="retouch-range"><Clock3 size={14} /><strong>镜头 {String(selectedIndex + 1).padStart(2, "0")}</strong><span>{formatSeconds(range.start)} - {formatSeconds(range.end)}</span><em>片段长度 {formatSeconds(selected.duration)}</em></div>
        <label><span>短标题</span><input disabled={!editable} value={draft.headline} onChange={(event) => setDraft({ ...draft, headline: event.target.value })} /></label>
        <label><span>旁白</span><textarea disabled={!editable} rows={3} value={draft.narration} onChange={(event) => setDraft({ ...draft, narration: event.target.value })} /></label>
        <label><span>画面描述</span><textarea disabled={!editable} rows={4} value={draft.visualPrompt} onChange={(event) => setDraft({ ...draft, visualPrompt: event.target.value })} /></label>

        <div className="retouch-materials">
          <div className="retouch-material-heading"><strong>镜头素材</strong><span>{draft.materialBindings?.length ?? 0} 项</span></div>
          <div className="retouch-material-add">
            <select aria-label="添加素材" disabled={!editable} value={selectedMaterialId} onChange={(event) => setSelectedMaterialId(event.target.value)}>
              <option value="">从素材库选择</option>
              {materials.map((material) => <option key={material.id} value={material.id}>@{material.variableName} · {material.name}</option>)}
            </select>
            <button disabled={!editable || !selectedMaterialId} onClick={() => { const material = materials.find((item) => item.id === selectedMaterialId); if (material) addMaterial(material); }}><Plus size={15} />添加</button>
            <button disabled={!editable || uploading} onClick={() => uploadInput.current?.click()}>{uploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}上传并添加</button>
            <input ref={uploadInput} className="visually-hidden" type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.csv,.xlsx" onChange={(event) => void upload(event)} />
          </div>

          {(draft.materialBindings ?? []).map((binding, index) => {
            const material = materials.find((item) => item.id === binding.materialId);
            if (!material) return null;
            const purpose = getMaterialPurpose(binding);
            const showAdvanced = purpose === "exact" || purpose === "data";
            return <div className="retouch-binding" key={`${binding.materialId}-${index}`}>
              <div className="retouch-material-identity"><span>{materialIcon(material)}</span><div><strong>@{binding.variableName}</strong><small>{material.name}</small></div></div>
              <label className="retouch-control"><span>替换为</span><select aria-label={`替换素材 ${index + 1}`} disabled={!editable} value={binding.materialId} onChange={(event) => { const next = materials.find((item) => item.id === event.target.value); if (next) replaceMaterial(index, next); }}>{materials.map((item) => <option key={item.id} value={item.id}>@{item.variableName}</option>)}</select></label>
              <label className="retouch-control"><span>素材用途</span><select aria-label="素材用途" disabled={!editable} value={purpose} onChange={(event) => updateBinding(index, applyMaterialPurpose(binding, material, event.target.value as MaterialPurpose))}>{getMaterialPurposeOptions(material).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <button className="retouch-remove" title="移除素材" disabled={!editable} onClick={() => removeMaterial(index)}><Trash2 size={15} /></button>
              {showAdvanced && <details className="retouch-advanced">
                <summary><SlidersHorizontal size={13} />高级设置</summary>
                <div className="retouch-advanced-grid">
                  <label className="retouch-control"><span>位置</span><select aria-label="素材位置" disabled={!editable} value={binding.placement} onChange={(event) => updateBinding(index, { placement: event.target.value as MaterialPlacement })}>{placementOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label className="retouch-time"><span>开始</span><input aria-label="素材开始时间" disabled={!editable} type="number" min="0" max={selected.duration} step="0.1" value={binding.startOffset ?? 0} onChange={(event) => updateBinding(index, { startOffset: Number(event.target.value) })} /><em>s</em></label>
                  <label className="retouch-time"><span>结束</span><input aria-label="素材结束时间" disabled={!editable} type="number" min="0" max={selected.duration} step="0.1" value={binding.endOffset ?? selected.duration} onChange={(event) => updateBinding(index, { endOffset: Number(event.target.value) })} /><em>s</em></label>
                  {purpose === "data" && material.dataAsset && binding.chart && <div className="retouch-chart-config">
                    <label><span>图表</span><select value={binding.chart.type} onChange={(event) => updateBinding(index, { chart: { ...binding.chart!, type: event.target.value as "line" | "bar" | "table" } })}><option value="line">折线图</option><option value="bar">柱状图</option><option value="table">数据表</option></select></label>
                    <label><span>横轴</span><select value={binding.chart.xColumn} onChange={(event) => updateBinding(index, { chart: { ...binding.chart!, xColumn: event.target.value } })}>{material.dataAsset.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
                    <label><span>数值</span><select value={binding.chart.yColumns[0] ?? ""} onChange={(event) => updateBinding(index, { chart: { ...binding.chart!, yColumns: [event.target.value] } })}>{material.dataAsset.numericColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
                  </div>}
                </div>
              </details>}
            </div>;
          })}
        </div>

        <div className="retouch-actions">
          <button className="secondary-action" disabled={!editable || Boolean(submittingAction)} onClick={() => void submit("none")}>{submittingAction === "none" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}应用并重新合成</button>
          <button className="edit-existing-shot" disabled={!editable || Boolean(submittingAction) || selected.assetType === "data_visualization"} onClick={() => void submit("edit")}>{submittingAction === "edit" ? <LoaderCircle className="spin" size={16} /> : <Repeat2 size={16} />}编辑原镜头</button>
          <button className="regenerate-shot" disabled={!editable || Boolean(submittingAction) || selected.assetType === "data_visualization"} onClick={() => void submit("regenerate")}>{submittingAction === "regenerate" ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}完全重做镜头</button>
        </div>
      </div>

      {revisions.length > 0 && <div className="revision-strip"><span><History size={14} />历史版本</span>{revisions.slice(0, 5).map((revision, index) => <button key={revision.id} disabled={!canRestore || Boolean(submittingAction)} onClick={() => void restore(revision)}><RotateCcw size={13} />修改前版本 {revisions.length - index}</button>)}</div>}
    </section>
  );
}
