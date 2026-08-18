import { useEffect, useState } from "react";
import { Check, LoaderCircle, Trash2, X } from "lucide-react";
import type { ProviderSettingsView } from "../shared/provider-settings";
import { api } from "./api";
import {
  buildScriptSettingsInput,
  buildVideoSettingsInput,
  type ScriptSettingsForm,
  type VideoSettingsForm
} from "./provider-settings-form";

interface ProviderSettingsDialogProps {
  initial: ProviderSettingsView;
  onClose: () => void;
  onSaved: (view: ProviderSettingsView) => void;
}

const scriptDefaults = {
  deepseek: { model: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
  openai: { model: "", baseUrl: "https://api.openai.com/v1" },
  ark: { model: "doubao-seed-2-1-pro-260628", baseUrl: "" }
};

function initialScriptForm(view: ProviderSettingsView): ScriptSettingsForm {
  const sessionMode = view.script.source === "session" && ["deepseek", "openai", "ark"].includes(view.script.provider)
    ? view.script.provider as ScriptSettingsForm["mode"]
    : "server";
  const defaults = sessionMode === "server" ? scriptDefaults.deepseek : scriptDefaults[sessionMode];
  return {
    mode: sessionMode,
    apiKey: "",
    model: view.script.model ?? defaults.model,
    baseUrl: view.script.baseUrl ?? defaults.baseUrl
  };
}

function initialVideoForm(view: ProviderSettingsView): VideoSettingsForm {
  return {
    mode: view.video.source === "session" && view.video.provider === "ark" ? "ark" : "server",
    apiKey: "",
    model: view.video.model ?? "doubao-seedance-2-0-mini-260615",
    maxGeneratedShots: view.video.maxGeneratedShots && view.video.maxGeneratedShots > 0
      ? view.video.maxGeneratedShots
      : 3
  };
}

function sourceLabel(source: "session" | "server" | "local"): string {
  if (source === "session") return "个人会话";
  if (source === "server") return "服务器默认";
  return "本地模式";
}

export function ProviderSettingsDialog({ initial, onClose, onSaved }: ProviderSettingsDialogProps) {
  const [script, setScript] = useState(() => initialScriptForm(initial));
  const [video, setVideo] = useState(() => initialVideoForm(initial));
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState("");
  const hasPersonalSettings = initial.script.hasSessionKey || initial.video.hasSessionKey;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving && !clearing) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [clearing, onClose, saving]);

  function selectScriptMode(mode: ScriptSettingsForm["mode"]) {
    if (mode === "server") {
      setScript((current) => ({ ...current, mode, apiKey: "" }));
      return;
    }
    setScript((current) => ({
      ...current,
      mode,
      apiKey: "",
      model: current.mode === "server" ? scriptDefaults[mode].model : current.model,
      baseUrl: current.mode === "server" ? scriptDefaults[mode].baseUrl : current.baseUrl
    }));
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      const view = await api.saveProviderSettings({
        script: buildScriptSettingsInput(script, initial.script),
        video: buildVideoSettingsInput(video, initial.video)
      });
      setScript((current) => ({ ...current, apiKey: "" }));
      setVideo((current) => ({ ...current, apiKey: "" }));
      onSaved(view);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "API 设置保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setClearing(true);
    setError("");
    try {
      const view = await api.clearProviderSettings();
      setScript(initialScriptForm(view));
      setVideo(initialVideoForm(view));
      setConfirmClear(false);
      onSaved(view);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "个人设置清除失败");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="provider-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="provider-settings-header">
          <div>
            <span className="dialog-kicker">当前浏览器会话</span>
            <h2 id="provider-settings-title">API 设置</h2>
          </div>
          <button className="dialog-close" type="button" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="provider-settings-grid">
          <section className="provider-settings-section">
            <div className="provider-section-heading"><h3>脚本 API</h3><span>{sourceLabel(initial.script.source)}</span></div>
            <label className="field">
              <span>服务商</span>
              <select value={script.mode} onChange={(event) => selectScriptMode(event.target.value as ScriptSettingsForm["mode"])}>
                <option value="server">服务器默认</option>
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI 兼容</option>
                <option value="ark">火山方舟</option>
              </select>
            </label>
            {script.mode !== "server" && <>
              <label className="field">
                <span>API Key {initial.script.hasSessionKey && initial.script.provider === script.mode && <em>已保存</em>}</span>
                <input type="password" autoComplete="new-password" value={script.apiKey} onChange={(event) => setScript({ ...script, apiKey: event.target.value })} placeholder={initial.script.hasSessionKey && initial.script.provider === script.mode ? "留空保持不变" : "输入 API Key"} />
              </label>
              <label className="field">
                <span>模型</span>
                <input value={script.model} onChange={(event) => setScript({ ...script, model: event.target.value })} maxLength={120} />
              </label>
              {script.mode !== "ark" && <label className="field">
                <span>Base URL</span>
                <input type="url" value={script.baseUrl} onChange={(event) => setScript({ ...script, baseUrl: event.target.value })} maxLength={500} />
              </label>}
            </>}
          </section>

          <section className="provider-settings-section">
            <div className="provider-section-heading"><h3>视频 API</h3><span>{sourceLabel(initial.video.source)}</span></div>
            <label className="field">
              <span>服务商</span>
              <select value={video.mode} onChange={(event) => setVideo({ ...video, mode: event.target.value as VideoSettingsForm["mode"], apiKey: "" })}>
                <option value="server">服务器默认</option>
                <option value="ark">Ark Seedance</option>
              </select>
            </label>
            {video.mode === "ark" && <>
              <label className="field">
                <span>API Key {initial.video.hasSessionKey && <em>已保存</em>}</span>
                <input type="password" autoComplete="new-password" value={video.apiKey} onChange={(event) => setVideo({ ...video, apiKey: event.target.value })} placeholder={initial.video.hasSessionKey ? "留空保持不变" : "输入 API Key"} />
              </label>
              <label className="field">
                <span>模型</span>
                <input value={video.model} onChange={(event) => setVideo({ ...video, model: event.target.value })} maxLength={120} />
              </label>
              <label className="field">
                <span>AI 生成镜头数</span>
                <input type="number" min={1} max={6} step={1} value={video.maxGeneratedShots} onChange={(event) => setVideo({ ...video, maxGeneratedShots: Number(event.target.value) })} />
              </label>
            </>}
          </section>
        </div>

        {error && <p className="provider-settings-error" role="alert">{error}</p>}
        <footer className="provider-settings-actions">
          {hasPersonalSettings && <button className={`clear-provider-settings ${confirmClear ? "confirming" : ""}`} type="button" disabled={saving || clearing} onClick={clear}>
            {clearing ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}
            {confirmClear ? "确认清除" : "清除个人设置"}
          </button>}
          <span />
          <button className="text-action" type="button" disabled={saving || clearing} onClick={onClose}>取消</button>
          <button className="primary-action compact-action" type="button" disabled={saving || clearing} onClick={save}>
            {saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}
            {saving ? "正在保存" : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );
}
