import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, CircleAlert, Cpu, Mic, MicOff, RefreshCw, Send, Sparkles, Trash2, UserRound, Volume2, VolumeX } from "lucide-react";

type OllamaModel = { name: string; size?: number };
type ChatMessage = { role: "user" | "assistant"; content: string; id: number };

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

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
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setError("La lecture vocale n'est pas disponible dans ce système. Tu peux toujours lire les réponses à l'écran.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, []);

  const refreshModels = useCallback(async () => {
    if (!runtime) {
      setError("Ouvre NEXUS CONTROL dans l’application de bureau pour accéder au serveur Ollama local.");
      return;
    }
    setLoadingModels(true);
    setError("");
    try {
      const installed = await invoke<OllamaModel[]>("list_ollama_models");
      setModels(installed);
      setModel((current) => installed.some((item) => item.name === current)
        ? current
        : (installed.find((item) => item.name === "qwen2.5:0.5b")?.name ?? installed[0]?.name ?? ""));
      if (installed.length === 0) setError("Ollama a démarré, mais aucun modèle n'est installé. Télécharge-en un avec « ollama pull nom-du-modèle ».");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoadingModels(false);
    }
  }, [runtime]);

  useEffect(() => { void refreshModels(); }, [refreshModels]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, sending]);
  useEffect(() => () => {
    window.speechSynthesis?.cancel();
    recognitionRef.current?.stop();
  }, []);

  const toggleVoiceInput = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setError("La dictée vocale n'est pas prise en charge par ce WebView. Tu peux écrire ton message puis activer la lecture vocale des réponses.");
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.lang = "fr-FR";
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join(" ").trim();
        if (transcript) setDraft((current) => current ? current + " " + transcript : transcript);
      };
      recognition.onerror = () => {
        setListening(false);
        setError("La dictée vocale a échoué. Vérifie l'autorisation du microphone et réessaie.");
      };
      recognition.onend = () => setListening(false);
      recognitionRef.current = recognition;
      setError("");
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setError("Impossible d'activer le microphone. Vérifie ses autorisations système.");
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !model || sending) return;
    if (!runtime) {
      setError("Le chat local est disponible dans l’application de bureau NEXUS CONTROL.");
      return;
    }

    const userMessage: ChatMessage = { role: "user", content, id: Date.now() };
    const conversation = [...messages, userMessage].slice(-30);
    setMessages(conversation);
    setDraft("");
    setSending(true);
    setError("");
    try {
      const answer = await invoke<string>("ollama_chat", {
        model,
        messages: conversation.map(({ role, content: text }) => ({ role, content: text })),
      });
      setMessages((current) => [...current, { role: "assistant", content: answer, id: Date.now() + 1 }]);
      if (voiceReplies) speak(answer);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSending(false);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return "";
    const gb = bytes / 1_000_000_000;
    return gb >= 1 ? `${gb.toFixed(1)} Go` : `${Math.round(bytes / 1_000_000)} Mo`;
  };

  return (
    <section className="page-body ai-chat-page">
      <div className="ai-chat-toolbar panel">
        <div className="ai-model-summary">
          <div className="ai-model-icon"><Cpu size={20} /></div>
          <div><strong>Modèles Ollama locaux</strong><span>{models.length} modèle(s) installé(s) · les messages restent sur ce PC</span></div>
        </div>
        <div className="ai-chat-controls">
          <label className="ai-model-select-label" htmlFor="nexus-ai-model">Modèle</label>
          <select id="nexus-ai-model" value={model} onChange={(event) => setModel(event.target.value)} disabled={!models.length || sending}>
            {models.length === 0 && <option value="">Aucun modèle détecté</option>}
            {models.map((item) => <option key={item.name} value={item.name}>{item.name}{item.size ? ` · ${formatSize(item.size)}` : ""}</option>)}
          </select>
          <button className={`button ${voiceReplies ? "button-primary" : "button-secondary"}`} onClick={() => { const next = !voiceReplies; setVoiceReplies(next); if (!next) window.speechSynthesis?.cancel(); }} type="button" aria-pressed={voiceReplies} title="Activer ou désactiver la lecture automatique">
            {voiceReplies ? <Volume2 size={14} /> : <VolumeX size={14} />} {voiceReplies ? "Voix activée" : "Réponses écrites"}
          </button>
          <button className="button button-secondary" onClick={() => void refreshModels()} disabled={loadingModels || sending} type="button" title="Actualiser les modèles">
            <RefreshCw size={14} className={loadingModels ? "spin" : ""} /> Actualiser
          </button>
          <button className="button button-secondary" onClick={() => { setMessages([]); setError(""); window.speechSynthesis?.cancel(); }} disabled={sending || messages.length === 0} type="button" title="Effacer la conversation">
            <Trash2 size={14} /> Effacer
          </button>
        </div>
      </div>

      {error && <div className="ai-chat-error"><CircleAlert size={16} /><span>{error}</span></div>}

      <div className="ai-chat-panel panel">
        <div className="ai-chat-messages" aria-live="polite">
          {messages.length === 0 && <div className="ai-chat-empty">
            <div className="ai-chat-empty-icon"><Sparkles size={25} /></div>
            <h2>Discute avec tes modèles IA</h2>
            <p>Écris ton message ou utilise le microphone si la dictée est prise en charge. L'assistant répond à l'écran et peut lire ses réponses à voix haute quand tu actives la voix.</p>
            {models.length === 0 && <button className="button button-primary" type="button" onClick={() => void refreshModels()} disabled={loadingModels}><RefreshCw size={14} className={loadingModels ? "spin" : ""}/> Détecter les modèles</button>}
          </div>}
          {messages.map((message) => <article className={`ai-message ${message.role === "user" ? "ai-message-user" : "ai-message-assistant"}`} key={message.id}>
            <div className="ai-message-avatar">{message.role === "user" ? <UserRound size={16} /> : <Bot size={17} />}</div>
            <div className="ai-message-content">
              <div className="ai-message-author">{message.role === "user" ? "Toi" : model}</div>
              <p>{message.content}</p>
              {message.role === "assistant" && <button className="ai-speak-message" type="button" onClick={() => speak(message.content)} title="Lire cette réponse à voix haute"><Volume2 size={14}/> Écouter</button>}
            </div>
          </article>)}
          {sending && <div className="ai-message ai-message-assistant"><div className="ai-message-avatar"><Bot size={17}/></div><div className="ai-message-content"><div className="ai-message-author">{model}</div><p className="ai-thinking"><span/><span/><span/> Le modèle réfléchit…</p></div></div>}
          <div ref={bottomRef} />
        </div>
        <form className="ai-chat-composer" onSubmit={sendMessage}>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={model ? `Écris à ${model}…` : "Ollama démarre automatiquement ; installe un modèle si nécessaire…"} rows={2} maxLength={12000} disabled={!model || sending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <div className="ai-chat-composer-footer">
            <span>Entrée pour envoyer · Maj + Entrée pour une nouvelle ligne</span>
            <div className="ai-composer-actions">
              <button className={`button ${listening ? "button-primary" : "button-secondary"}`} type="button" onClick={toggleVoiceInput} disabled={!model || sending} title="Dicter un message">
                {listening ? <MicOff size={15}/> : <Mic size={15}/>} {listening ? "Arrêter" : "Dicter"}
              </button>
              <button className="button button-primary" type="submit" disabled={!draft.trim() || !model || sending}><Send size={15}/>{sending ? "Réponse…" : "Envoyer"}</button>
            </div>
          </div>
        </form>
      </div>
      <div className="info-banner"><Bot size={17}/><div><strong>IA locale — sans clé API cloud</strong><p>NEXUS CONTROL démarre Ollama automatiquement si nécessaire. La voix utilise les fonctions vocales du système/WebView et peut dépendre des langues et autorisations disponibles. Le chat lui-même reste local sur 127.0.0.1:11434.</p></div></div>
    </section>
  );
}
