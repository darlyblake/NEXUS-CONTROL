import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, CircleAlert, Mic, MicOff, RefreshCw, Send, Sparkles, UserRound, Volume2, VolumeX, Wrench, MessageSquare, Trash2 } from "lucide-react";

type OllamaModel = { name: string; size?: number };
type ChatMessage = { role: "user" | "assistant"; content: string; id: number };
type AgentSettings = { model?: string; workspace?: string; allowWrite?: boolean; browserEnabled?: boolean };
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void;
};
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

function detectKnownFolderCommand(input: string): string | null {
  const text = input.toLocaleLowerCase("fr-FR").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "");
  if (!/\\b(ouvre|ouvrir|affiche|montre|accede|va dans|lance)\\b/.test(text) || !/\\b(dossier|repertoire|folder)\\b/.test(text)) return null;
  const folders: Array<[RegExp, string]> = [
    [/\\b(musique|music)\\b/, "musique"],
    [/\\b(documents?|mes documents)\\b/, "documents"],
    [/\\b(telechargements?|downloads?)\\b/, "telechargements"],
    [/\\b(images?|photos?|pictures?)\\b/, "images"],
    [/\\b(videos?)\\b/, "videos"],
    [/\\b(bureau|desktop)\\b/, "bureau"],
    [/\\b(dossier personnel|home|accueil)\\b/, "home"],
  ];
  return folders.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

const SETTINGS_KEY = "nexus.ai.settings";
function readAgentSettings(): AgentSettings {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as AgentSettings; } catch { return {}; }
}

export function LocalAIChat({ runtime }: { runtime: boolean }) {
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [voiceReplies, setVoiceReplies] = useState(false);
  const [listening, setListening] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setError("La lecture vocale n'est pas disponible dans ce système.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR"; utterance.rate = 1; utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  const refreshModels = useCallback(async () => {
    if (!runtime) { setError("Ouvre NEXUS CONTROL dans l’application de bureau pour accéder à Ollama."); return; }
    setLoadingModels(true); setError("");
    try {
      const installed = await invoke<OllamaModel[]>("list_ollama_models");
      setModels(installed);
      const saved = readAgentSettings().model || "";
      setModel(current => installed.some(item => item.name === current) ? current : (installed.find(item => item.name === saved)?.name ?? installed.find(item => item.name === "qwen2.5:0.5b")?.name ?? installed[0]?.name ?? ""));
      if (!installed.length) setError("Aucun modèle installé. Télécharge-en un avec « ollama pull nom-du-modèle ».");
    } catch (cause) { setError(String(cause)); }
    finally { setLoadingModels(false); }
  }, [runtime]);

  useEffect(() => { void refreshModels(); }, [refreshModels]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);
  useEffect(() => () => { window.speechSynthesis?.cancel(); recognitionRef.current?.stop(); }, []);

  const toggleVoiceInput = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return; }
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setError("La dictée vocale n'est pas prise en charge par ce WebView."); return; }
    try {
      const recognition = new Recognition();
      recognition.lang = "fr-FR"; recognition.interimResults = false;
      recognition.onresult = event => {
        const transcript = Array.from(event.results).map(result => result[0]?.transcript ?? "").join(" ").trim();
        if (transcript) setDraft(current => current ? current + " " + transcript : transcript);
      };
      recognition.onerror = () => { setListening(false); setError("La dictée vocale a échoué. Vérifie l'autorisation du microphone."); };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition; setError(""); recognition.start(); setListening(true);
    } catch { setListening(false); setError("Impossible d'activer le microphone. Vérifie ses autorisations système."); }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !model || sending) return;
    if (!runtime) { setError("Le chat local est disponible dans l’application de bureau NEXUS CONTROL."); return; }

    const userMessage: ChatMessage = { role: "user", content, id: Date.now() };
    const conversation = [...messages, userMessage].slice(-24);
    setMessages(conversation); setDraft(""); setSending(true); setError("");
    try {
      let answer: string;
      const knownFolder = detectKnownFolderCommand(content);
      if (knownFolder) {
        answer = await invoke<string>("open_known_folder", { name: knownFolder });
      } else if (agentMode) {
        const config = readAgentSettings();
        const workspace = (config.workspace || "").trim();
        const allowWrite = config.allowWrite === true;
        const browserEnabled = config.browserEnabled === true;
        if (!workspace && (!browserEnabled || allowWrite)) throw new Error("Configure un dossier de travail dans Paramètres → Assistant IA. Pour utiliser uniquement le navigateur, active-le dans ces paramètres et laisse l’écriture désactivée.");
        if (allowWrite && !window.confirm("Autoriser l'IA à créer ou remplacer des fichiers texte dans le dossier configuré ?")) throw new Error("Opération annulée : autorisation d’écriture non accordée.");
        if (browserEnabled && !window.confirm("Autoriser cette requête à piloter un navigateur dédié ? Les formulaires ne seront pas soumis automatiquement.")) throw new Error("Opération annulée : autorisation du navigateur non accordée.");
        answer = await invoke<string>("ollama_agent_chat", {
          model,
          messages: conversation.map(({ role, content: text }) => ({ role, content: text })),
          workspaceRoot: workspace, allowWrite, browserEnabled
        });
      } else {
        answer = await invoke<string>("ollama_chat", {
          model,
          messages: conversation.map(({ role, content: text }) => ({ role, content: text }))
        });
      }
      setMessages(current => [...current, { role: "assistant", content: answer, id: Date.now() + 1 }]);
      if (voiceReplies) speak(answer);
    } catch (cause) { setError(String(cause)); }
    finally { setSending(false); }
  };

  return (
    <section className="page-body ai-chat-page ai-chat-page-clean">
      <div className="ai-chat-shell">
        <header className="ai-chat-header">
          <div className="ai-chat-header-identity">
            <div className="ai-model-icon"><Bot size={21}/></div>
            <div><strong>Assistant IA</strong><span>{model ? model + " · Ollama local" : "Connexion au modèle local…"}{agentMode ? " · mode agent" : ""}</span></div>
          </div>
          <div className="ai-chat-header-actions">
            <button className={`button ${agentMode ? "button-primary" : "button-secondary"}`} type="button" onClick={() => setAgentMode(value => !value)} aria-pressed={agentMode} title="Basculer entre conversation et agent">
              {agentMode ? <Wrench size={15}/> : <MessageSquare size={15}/>} {agentMode ? "Mode agent" : "Mode chat"}
            </button>
            <button className="ai-icon-action" type="button" onClick={() => { setMessages([]); setError(""); window.speechSynthesis?.cancel(); }} disabled={sending || messages.length === 0} title="Nouvelle conversation" aria-label="Nouvelle conversation"><Trash2 size={17}/></button>
            <button className="ai-icon-action" type="button" onClick={() => { const next = !voiceReplies; setVoiceReplies(next); if (!next) window.speechSynthesis?.cancel(); }} aria-pressed={voiceReplies} title={voiceReplies ? "Désactiver la lecture vocale" : "Activer la lecture vocale"} aria-label="Lecture vocale">{voiceReplies ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button>
            <button className="ai-icon-action" type="button" onClick={() => void refreshModels()} disabled={loadingModels || sending} title="Recharger le modèle" aria-label="Actualiser le modèle"><RefreshCw size={17} className={loadingModels ? "spin" : ""}/></button>
          </div>
        </header>

        {error && <div className="ai-chat-error"><CircleAlert size={16}/><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Fermer">×</button></div>}

        <div className="ai-chat-panel ai-chat-panel-clean">
          <div className="ai-chat-messages" aria-live="polite">
            {messages.length === 0 && <div className="ai-chat-empty">
              <div className="ai-chat-empty-icon"><Sparkles size={25}/></div>
              <h2>Comment puis-je t'aider ?</h2>
              <p>{agentMode ? "Décris une tâche. L’agent utilisera uniquement les accès configurés dans Paramètres → Assistant IA." : "Pose une question, demande une explication ou travaille sur ton code. Tes échanges passent par le modèle Ollama local."}</p>
              {!models.length && <button className="button button-secondary" type="button" onClick={() => void refreshModels()} disabled={loadingModels}><RefreshCw size={14} className={loadingModels ? "spin" : ""}/> Détecter les modèles</button>}
            </div>}
            {messages.map(message => <article className={`ai-message ${message.role === "user" ? "ai-message-user" : "ai-message-assistant"}`} key={message.id}>
              <div className="ai-message-avatar">{message.role === "user" ? <UserRound size={16}/> : <Bot size={17}/>}</div>
              <div className="ai-message-content"><div className="ai-message-author">{message.role === "user" ? "Toi" : model || "Assistant IA"}</div><p>{message.content}</p>
                {message.role === "assistant" && <button className="ai-speak-message" type="button" onClick={() => speak(message.content)} title="Lire cette réponse à voix haute"><Volume2 size={14}/> Écouter</button>}
              </div>
            </article>)}
            {sending && <div className="ai-message ai-message-assistant"><div className="ai-message-avatar"><Bot size={17}/></div><div className="ai-message-content"><div className="ai-message-author">{agentMode ? "Agent local" : model}</div><p className="ai-thinking"><span/><span/><span/> {agentMode ? "L'agent travaille…" : "Le modèle réfléchit…"}</p></div></div>}
            <div ref={bottomRef}/>
          </div>
          <form className="ai-chat-composer ai-chat-composer-clean" onSubmit={sendMessage}>
            <textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder={agentMode ? "Décris la tâche à effectuer…" : "Écris ton message…"} rows={2} maxLength={12000} disabled={!model || sending} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
            <div className="ai-chat-composer-footer">
              <div className="ai-composer-tools"><button className={`ai-icon-action ${listening ? "active" : ""}`} type="button" onClick={toggleVoiceInput} disabled={!model || sending} title={listening ? "Arrêter la dictée" : "Dicter un message"} aria-label={listening ? "Arrêter la dictée" : "Dicter un message"}>{listening ? <MicOff size={18}/> : <Mic size={18}/>}</button><span>{agentMode ? "Agent : accès définis dans les paramètres" : "Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne"}</span></div>
              <button className="button button-primary ai-send-button" type="submit" disabled={!draft.trim() || !model || sending} aria-label="Envoyer"><Send size={16}/>{sending ? "Réponse…" : "Envoyer"}</button>
            </div>
          </form>
        </div>
        <p className="ai-chat-privacy-note"><span className="status-dot dot-green"/> Modèle local · aucun compte cloud requis</p>
      </div>
    </section>
  );
}
