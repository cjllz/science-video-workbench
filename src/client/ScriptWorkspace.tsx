import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileAudio, FileImage, FileVideo, Link2, LoaderCircle, Play, Plus, Save, SlidersHorizontal, Table2, Trash2, Upload } from "lucide-react";
import type { MaterialAsset, MaterialPlacement, ShotMaterialBinding, ShotPlan, VideoJob, VideoPlan } from "../shared/video";
import { api } from "./api";
import { applyMaterialPurpose, createDefaultBinding, getMaterialPurpose, getMaterialPurposeOptions, type MaterialPurpose } from "./material-bindings";

interface Props {
  job: VideoJob;
  materials: MaterialAsset[];
  onMaterialAdded: (material: MaterialAsset) => void;
  onMaterialRenamed: (material: MaterialAsset) => void;
  onJobUpdated: (job: VideoJob) => void;
  onError: (message: string) => void;
}

const placementOptions: Array<[MaterialPlacement, string]> = [["full", "全画面"], ["center", "居中"], ["top-left", "左上"], ["top-right", "右上"], ["bottom-left", "左下"], ["bottom-right", "右下"]];

function kindIcon(kind: MaterialAsset["kind"]) {
  if (kind === "image") return <FileImage size={16} />;
  if (kind === "video") return <FileVideo size={16} />;
  if (kind === "audio") return <FileAudio size={16} />;
  return <Table2 size={16} />;
}

function normalizePlan(plan: VideoPlan): VideoPlan {
  const shots = plan.shots.map((shot, index) => ({ ...shot, index }));
  return { ...plan, script: shots.map((shot) => shot.narration).join(""), shots };
}

export function ScriptWorkspace({ job, materials, onMaterialAdded, onMaterialRenamed, onJobUpdated, onError }: Props) {
  const [plan, setPlan] = useState<VideoPlan>(() => structuredClone(job.plan!));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedByShot, setSelectedByShot] = useState<Record<string, string>>({});
  const uploadInput = useRef<HTMLInputElement>(null);

  useEffect(() => setPlan(structuredClone(job.plan!)), [job.id, job.updatedAt]);

  function updateShot(id: string, patch: Partial<ShotPlan>) {
    setPlan((current) => normalizePlan({ ...current, shots: current.shots.map((shot) => shot.id === id ? { ...shot, ...patch } : shot) }));
  }

  function moveShot(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= plan.shots.length) return;
    const shots = [...plan.shots];
    [shots[index], shots[target]] = [shots[target], shots[index]];
    setPlan(normalizePlan({ ...plan, shots }));
  }

  function insertMaterial(shot: ShotPlan) {
    const material = materials.find((item) => item.id === selectedByShot[shot.id]);
    if (!material) return;
    const existing = shot.materialBindings ?? [];
    const binding = createDefaultBinding(material, shot.duration);
    const alreadyBound = existing.some((item) => item.materialId === material.id && item.variableName === material.variableName);
    updateShot(shot.id, {
      visualPrompt: shot.visualPrompt.includes(`@${material.variableName}`) ? shot.visualPrompt : `${shot.visualPrompt.trim()}，使用 @${material.variableName}`,
      materialBindings: alreadyBound ? existing : [...existing, binding]
    });
  }

  function updateBinding(shot: ShotPlan, bindingIndex: number, patch: Partial<ShotMaterialBinding>) {
    const bindings = (shot.materialBindings ?? []).map((binding, index) => index === bindingIndex ? { ...binding, ...patch } : binding);
    updateShot(shot.id, { materialBindings: bindings });
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      onMaterialAdded(await api.uploadMaterial(file));
    } catch (error) {
      onError(error instanceof Error ? error.message : "素材上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function rename(material: MaterialAsset, value: string) {
    const variableName = value.trim();
    if (!variableName || variableName === material.variableName) return;
    try {
      onMaterialRenamed(await api.renameMaterial(material.id, variableName));
    } catch (error) {
      onError(error instanceof Error ? error.message : "变量重命名失败");
    }
  }

  async function save(render: boolean) {
    setSaving(true);
    try {
      const saved = await api.savePlan(job.id, normalizePlan(plan));
      onJobUpdated(saved);
      if (render) onJobUpdated(await api.renderJob(job.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : "剧本保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="script-workspace">
      <div className="script-toolbar">
        <div><span className="step-index">02</span><h2>剧本总览</h2><p>{plan.shots.length} 个镜头 · 总时长 {plan.shots.reduce((sum, shot) => sum + shot.duration, 0).toFixed(1)} 秒</p></div>
        <div className="script-actions">
          <button className="secondary-action" disabled={saving} onClick={() => void save(false)}><Save size={16} />保存剧本</button>
          <button className="confirm-render" disabled={saving} onClick={() => void save(true)}>{saving ? <LoaderCircle className="spin" size={17} /> : <Play size={17} fill="currentColor" />}确认并生成视频</button>
        </div>
      </div>

      <div className="script-layout">
        <div className="shot-editor-list">
          <label className="plan-title"><span>视频标题</span><input value={plan.title} onChange={(event) => setPlan({ ...plan, title: event.target.value })} /></label>
          {plan.shots.map((shot, index) => (
            <article className="shot-editor" key={shot.id}>
              <header>
                <span className="shot-index">镜头 {String(index + 1).padStart(2, "0")}</span>
                <div className="order-actions">
                  <button title="上移镜头" disabled={index === 0} onClick={() => moveShot(index, -1)}><ArrowUp size={15} /></button>
                  <button title="下移镜头" disabled={index === plan.shots.length - 1} onClick={() => moveShot(index, 1)}><ArrowDown size={15} /></button>
                </div>
                <label><span>时长</span><input type="number" min="1" max="15" step="0.5" value={shot.duration} onChange={(event) => updateShot(shot.id, { duration: Number(event.target.value) })} /><em>s</em></label>
              </header>
              <label><span>短标题</span><input value={shot.headline} onChange={(event) => updateShot(shot.id, { headline: event.target.value })} /></label>
              <label><span>旁白</span><textarea rows={3} value={shot.narration} onChange={(event) => updateShot(shot.id, { narration: event.target.value })} /></label>
              <label><span>画面设计</span><textarea rows={4} value={shot.visualPrompt} onChange={(event) => updateShot(shot.id, { visualPrompt: event.target.value })} /></label>
              <div className="material-insert">
                <select value={selectedByShot[shot.id] ?? ""} onChange={(event) => setSelectedByShot({ ...selectedByShot, [shot.id]: event.target.value })}>
                  <option value="">为这个镜头选择素材</option>
                  {materials.map((material) => <option key={material.id} value={material.id}>@{material.variableName} · {material.name}</option>)}
                </select>
                <button title="添加到这个镜头" disabled={!selectedByShot[shot.id]} onClick={() => insertMaterial(shot)}><Plus size={16} />添加</button>
              </div>
              {(shot.materialBindings ?? []).map((binding, bindingIndex) => {
                const material = materials.find((item) => item.id === binding.materialId);
                if (!material) return null;
                const purpose = getMaterialPurpose(binding);
                const showAdvanced = purpose === "exact" || purpose === "data";
                return (
                  <div className="binding-row" key={`${binding.materialId}-${bindingIndex}`}>
                    <div className="binding-identity"><strong><Link2 size={14} />@{binding.variableName}</strong><small>{material.name}</small></div>
                    <label className="binding-purpose"><span>素材用途</span><select aria-label="素材用途" value={purpose} onChange={(event) => updateBinding(shot, bindingIndex, applyMaterialPurpose(binding, material, event.target.value as MaterialPurpose))}>{getMaterialPurposeOptions(material).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <button className="binding-remove" title="移除素材" onClick={() => updateShot(shot.id, { materialBindings: (shot.materialBindings ?? []).filter((_, itemIndex) => itemIndex !== bindingIndex), visualPrompt: shot.visualPrompt.replaceAll(`@${binding.variableName}`, binding.variableName) })}><Trash2 size={14} /></button>
                    {showAdvanced && <details className="binding-advanced">
                      <summary><SlidersHorizontal size={13} />高级设置</summary>
                      <div className="binding-advanced-grid">
                        <label><span>位置</span><select aria-label="素材位置" value={binding.placement} onChange={(event) => updateBinding(shot, bindingIndex, { placement: event.target.value as MaterialPlacement })}>{placementOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                        <label><span>开始</span><input aria-label="素材开始时间" type="number" min="0" max={shot.duration} step="0.1" value={binding.startOffset ?? 0} onChange={(event) => updateBinding(shot, bindingIndex, { startOffset: Number(event.target.value) })} /></label>
                        <label><span>结束</span><input aria-label="素材结束时间" type="number" min="0" max={shot.duration} step="0.1" value={binding.endOffset ?? shot.duration} onChange={(event) => updateBinding(shot, bindingIndex, { endOffset: Number(event.target.value) })} /></label>
                        {purpose === "data" && material.dataAsset && binding.chart && <div className="chart-config">
                          <label><span>图表</span><select value={binding.chart.type} onChange={(event) => updateBinding(shot, bindingIndex, { chart: { ...binding.chart!, type: event.target.value as "line" | "bar" | "table" } })}><option value="line">折线图</option><option value="bar">柱状图</option><option value="table">数据表</option></select></label>
                          <label><span>横轴</span><select value={binding.chart.xColumn} onChange={(event) => updateBinding(shot, bindingIndex, { chart: { ...binding.chart!, xColumn: event.target.value } })}>{material.dataAsset.columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
                          <label><span>数值</span><select value={binding.chart.yColumns[0] ?? ""} onChange={(event) => updateBinding(shot, bindingIndex, { chart: { ...binding.chart!, yColumns: [event.target.value] } })}>{material.dataAsset.numericColumns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
                        </div>}
                      </div>
                    </details>}
                  </div>
                );
              })}
            </article>
          ))}
        </div>

        <aside className="material-library">
          <div className="material-heading"><div><h3>素材变量</h3><span>{materials.length} 项</span></div><button title="上传素材" disabled={uploading} onClick={() => uploadInput.current?.click()}>{uploading ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}上传</button></div>
          <input ref={uploadInput} className="visually-hidden" type="file" accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.mp3,.wav,.m4a,.aac,.csv,.xlsx" onChange={upload} />
          <div className="material-list">
            {materials.length === 0 && <p className="material-empty">尚未上传素材</p>}
            {materials.map((material) => (
              <div className="material-item" key={material.id}>
                <div className="material-preview">{material.kind === "image" ? <img src={material.url} alt="" /> : kindIcon(material.kind)}</div>
                <div><input aria-label="素材变量名" defaultValue={material.variableName} onBlur={(event) => void rename(material, event.target.value)} /><small>{material.name}</small>{material.dataAsset && <span>{material.dataAsset.rowCount} 行 · {material.dataAsset.columns.length} 列</span>}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
