import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Folder, Globe, LockKeyhole, RefreshCw, ShieldCheck, ShieldAlert, Volume2 } from "lucide-react";

type Model = { name: string; size?: number };
type AgentSettings = { model: string; workspace: string; allowWrite: boolean; browserEnabled: boolean; voiceReplies: boolean };
const SETTINGS_KEY = "nexus.ai.settings";
const defaults: AgentSettings = { model: "", workspace: "", allowWrite: false, browserEnabled: false, voiceReplies: false };

function readSettings(): AgentSettings {
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<AgentSettings>) }; }
  catch { return defaults; }
}

export function LocalAISettings({ runtime }: { runtime: boolean }) {
  const [models, setModels] = useState<Model[]>([]);
  const [settings, setSettings] = useState<AgentSettings>(readSettings);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const update = (patch: Partial<AgentSettings>) => {
    setSettings(current => {
      const next = { ...current, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* stockage local indisponible */ }
      return next;
    });
    setStatus("Paramètres de l’assistant enregistrés sur cet ordinateur.");
  };

  const refreshModels = useCallback(async () => {
    if (!runtime) { setStatus("La liste des modèles est disponible dans l’application de bureau."); return; }
    setLoading(true); setStatus("");
    try {
      const available = await invoke<Model[]>("list_ollama_models");
      setModels(available);
      setSettings(current => {
        const next = { ...current, model: available.some(item => item.name === current.model) ? current.model : (available[0]?.name || "") };
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
      if (!available.length) setStatus("Aucun modèle installé. Utilise « ollama pull nom-du-modèle » dans un terminal.");
      else setStatus(available.length + " modèle(s) local(aux) détecté(s).");
    } catch (error) { setStatus("Impossible de lire les modèles Ollama : " + String(error)); }
    finally { setLoading(false); }
  }, [runtime]);

  useEffect(() => { void refreshModels(); }, [refreshModels]);

  return <section className="ai-settings-section">
    <div className="ai-settings-title"><div className="ai-settings-title-icon"><Bot size={19}/></div><div><h2>Assistant IA</h2><p>Modèle, voix et autorisations de l’agent local. Ces options ne sont plus affichées dans le chat.</p></div></div>
    {status && <div className="ai-settings-status">{status}</div>}
    <div className="panel ai-settings-panel">
      <div className="ai-settings-row">
        <div className="ai-settings-row-icon"><Bot size={18}/></div><div className="ai-settings-row-copy"><strong>Modèle Ollama</strong><span>Choisis le modèle utilisé dans le chat et le mode agent.</span></div>
        <div className="ai-settings-row-control"><select value={settings.model} onChange={event => update({ model: event.target.value })} disabled={!models.length || loading}><option value="">Aucun modèle détecté</option>{models.map(item => <option key={item.name} value={item.name}>{item.name}{item.size ? " · " + (item.size / 1_000_000_000).toFixed(1) + " Go" : ""}</option>)}</select><button className="button button-secondary" type="button" onClick={() => void refreshModels()} disabled={loading}><RefreshCw size={14} className={loading ? "spin" : ""}/> Actualiser</button></div>
      </div>
      <div className="ai-settings-row ai-settings-row-stack">
        <div className="ai-settings-row-icon"><Folder size={18}/></div><div className="ai-settings-row-copy"><strong>Dossier de travail autorisé</strong><span>L’agent est limité à ce dossier pour les opérations sur les fichiers.</span></div>
        <input className="ai-settings-path" value={settings.workspace} onChange={event => update({ workspace: event.target.value })} placeholder="/home/ton-utilisateur/Projets/mon-projet" spellCheck={false}/>
      </div>
      <div className="ai-settings-row">
        <div className={"ai-settings-row-icon " + (settings.allowWrite ? "ai-settings-warning" : "")}>{settings.allowWrite ? <ShieldAlert size={18}/> : <ShieldCheck size={18}/>}</div><div className="ai-settings-row-copy"><strong>Autoriser l’écriture de fichiers</strong><span>{settings.allowWrite ? "L’agent pourra créer ou remplacer des fichiers texte dans le dossier configuré, après confirmation." : "Lecture seule : l’agent ne peut pas modifier le contenu des fichiers."}</span></div>
        <label className="ai-settings-toggle"><input type="checkbox" checked={settings.allowWrite} onChange={event => update({ allowWrite: event.target.checked })}/> Autoriser l’écriture</label>
      </div>
      <div className="ai-settings-row">
        <div className={"ai-settings-row-icon " + (settings.browserEnabled ? "ai-settings-warning" : "")}><Globe size={18}/></div><div className="ai-settings-row-copy"><strong>Navigation contrôlée</strong><span>{settings.browserEnabled ? "L’agent peut piloter un navigateur dédié sur demande. Les formulaires ne sont pas soumis automatiquement." : "Désactivée par défaut ; active-la seulement pour une tâche qui nécessite le navigateur."}</span></div>
        <label className="ai-settings-toggle"><input type="checkbox" checked={settings.browserEnabled} onChange={event => update({ browserEnabled: event.target.checked })}/> Autoriser le navigateur</label>
      </div>
      <div className="ai-settings-row">
        <div className="ai-settings-row-icon"><Volume2 size={18}/></div><div className="ai-settings-row-copy"><strong>Lecture vocale</strong><span>La lecture vocale peut aussi être activée directement dans l’en-tête du chat.</span></div>
        <label className="ai-settings-toggle"><input type="checkbox" checked={settings.voiceReplies} onChange={event => update({ voiceReplies: event.target.checked })}/> Préférence activée</label>
      </div>
      <div className="ai-settings-security"><LockKeyhole size={17}/><div><strong>Contrôles de sécurité</strong><p>L’écriture et le navigateur demandent une confirmation au moment de l’utilisation. L’agent n’obtient pas de terminal administrateur par ces réglages. Ne choisis que des dossiers que tu es autorisé à utiliser.</p></div></div>
    </div>
  </section>;
}
