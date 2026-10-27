import { useCallback, useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, CircleAlert, FileText, LockKeyhole, RefreshCw, Send, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";

type Model = { name: string; size?: number };
type Message = { role: "user" | "assistant"; content: string; id: number };

export function LocalAIAgent({ runtime }: { runtime: boolean }) {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [allowWrite, setAllowWrite] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshModels = useCallback(async () => {
    if (!runtime) return;
    try {
      const available = await invoke<Model[]>("list_ollama_models");
      setModels(available);
      setModel(current => available.some(item => item.name === current) ? current : (available.find(item => item.name.startsWith("qwen2.5"))?.name ?? available[0]?.name ?? ""));
    } catch (cause) { setError(String(cause)); }
  }, [runtime]);

  useEffect(() => { void refreshModels(); }, [refreshModels]);

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !model || busy) return;
    if (!workspace.trim()) { setError("Indique d'abord le dossier que l'IA est autorisée à lire."); return; }
    if (allowWrite && !window.confirm("Autoriser l'IA à créer ou remplacer des fichiers texte dans ce dossier ? Les modifications ne seront pas automatiquement annulées.")) return;

    const userMessage: Message = { role: "user", content: text, id: Date.now() };
    const nextMessages = [...messages, userMessage].slice(-24);
    setMessages(nextMessages); setDraft(""); setBusy(true); setError(""); setNotice("");
    try {
      const answer = await invoke<string>("ollama_agent_chat", {
        model,
        messages: nextMessages.map(({ role, content }) => ({ role, content })),
        workspaceRoot: workspace.trim(),
        allowWrite
      });
      setMessages(current => [...current, { role: "assistant", content: answer, id: Date.now() + 1 }]);
      setNotice(allowWrite ? "Accès en lecture et écriture activé pour cette requête." : "Accès en lecture seule utilisé pour cette requête.");
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  return <section className="page-body ai-agent-page">
    <div className="panel ai-agent-permissions">
      <div className="panel-header">
        <div><h3><FileText size={16} /> Agent local — fichiers et dossiers</h3><p>L'IA peut utiliser des outils pour examiner et, si tu l'autorises, modifier les fichiers de ce dossier.</p></div>
        <button className="button button-secondary" onClick={() => void refreshModels()} disabled={busy}><RefreshCw size={14}/> Modèles</button>
      </div>
      <div className="ai-agent-settings">
        <label className="ai-agent-field">Modèle Ollama
          <select value={model} onChange={event => setModel(event.target.value)} disabled={busy || models.length === 0}>
            {models.length === 0 && <option value="">Aucun modèle trouvé</option>}
            {models.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>
        <label className="ai-agent-field">Dossier autorisé (chemin absolu)
          <input value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder="/home/ton-utilisateur/Projets/mon-projet" spellCheck={false} disabled={busy}/>
        </label>
        <div className="ai-agent-permission-row">
          <div className={"ai-agent-permission-icon " + (allowWrite ? "danger" : "")}>{allowWrite ? <ShieldAlert size={18}/> : <ShieldCheck size={18}/>}</div>
          <div className="ai-agent-permission-copy">
            <strong>{allowWrite ? "Lecture + écriture" : "Lecture seule"}</strong>
            <span>{allowWrite ? "L'IA peut créer ou remplacer des fichiers texte dans le dossier choisi." : "L'IA peut lister les fichiers et lire le texte, sans modifier le contenu."}</span>
          </div>
          <label className="ai-agent-toggle"><input type="checkbox" checked={allowWrite} onChange={event => setAllowWrite(event.target.checked)} disabled={busy}/> Autoriser l'écriture</label>
        </div>
        <div className="info-banner"><LockKeyhole size={17}/><div><strong>Périmètre de sécurité</strong><p>Les outils sont limités au dossier choisi. Les chemins absolus et les tentatives de sortie du dossier sont refusés. Lecture limitée aux fichiers texte de 1 Mo, liste de 150 éléments maximum par dossier. Aucun terminal, accès administrateur, suppression ou accès réseau n'est donné à l'IA.</p></div></div>
      </div>
    </div>

    {error && <div className="ai-chat-error"><CircleAlert size={16}/><span>{error}</span></div>}
    {notice && <div className="ai-agent-notice"><ShieldCheck size={15}/>{notice}</div>}

    <div className="panel ai-agent-chat">
      <div className="panel-header">
        <div><h3><Bot size={17}/> Demande à l'agent</h3><p>Exemples : « liste les fichiers du dossier », « lis README.md », « crée un fichier notes.txt avec… ».</p></div>
        <button className="button button-secondary" type="button" disabled={busy || messages.length === 0} onClick={() => { setMessages([]); setError(""); setNotice(""); }}><Trash2 size={14}/> Effacer</button>
      </div>
      <div className="ai-agent-messages" aria-live="polite">
        {messages.length === 0 && <div className="ai-chat-empty"><div className="ai-chat-empty-icon"><Bot size={24}/></div><h2>Un agent qui agit sur les fichiers autorisés</h2><p>Commence en lecture seule. Active l'écriture uniquement lorsque tu veux vraiment que l'IA modifie ce dossier.</p></div>}
        {messages.map(message => <article className={"ai-message " + (message.role === "user" ? "ai-message-user" : "ai-message-assistant")} key={message.id}>
          <div className="ai-message-avatar">{message.role === "user" ? "T" : <Bot size={17}/>}</div>
          <div className="ai-message-content"><div className="ai-message-author">{message.role === "user" ? "Toi" : model || "Agent local"}</div><p className="ai-agent-message-text">{message.content}</p></div>
        </article>)}
        {busy && <div className="ai-agent-busy"><RefreshCw size={14} className="spin"/> L'agent examine les fichiers ou prépare sa réponse…</div>}
      </div>
      <form className="ai-chat-composer" onSubmit={send}>
        <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={2} maxLength={8000} placeholder="Décris la tâche à effectuer dans le dossier autorisé…" disabled={busy || !model} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }}}/>
        <div className="ai-chat-composer-footer"><span>Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne</span><button className="button button-primary" type="submit" disabled={busy || !draft.trim() || !model}><Send size={15}/>{busy ? "Traitement…" : "Envoyer à l'agent"}</button></div>
      </form>
    </div>
  </section>;
}
