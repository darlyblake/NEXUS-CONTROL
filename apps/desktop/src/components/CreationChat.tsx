import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Check, Download, FileText, ImagePlus, LoaderCircle, Paperclip, Send, Settings2, Sparkles, UserRound, X } from "lucide-react";
import "./CreationChat.css";

type Model = { name: string; size?: number };
type ChatItem = { id: number; role: "user" | "assistant"; text: string; file?: { name: string; content: string; format: string }; image?: string };
type ImageSettings = { endpoint: string; model: string; key: string; size: string };

const initialImageSettings: ImageSettings = {
  endpoint: "https://api.openai.com/v1/images/generations",
  model: "gpt-image-1",
  key: "",
  size: "1024x1024",
};

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "creation";
}
function downloadText(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function savePdf(title: string, content: string) {
  const win = window.open("", "_blank");
  if (!win) { window.alert("Autorise les fenêtres contextuelles pour enregistrer le PDF."); return; }
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  win.document.open();
  win.document.write("<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>" + escape(title) + "</title><style>body{font:12pt Arial,sans-serif;line-height:1.6;color:#172033;margin:20mm;white-space:pre-wrap}h1{font-size:20pt;color:#244a83}@media print{body{margin:15mm}}</style></head><body><h1>" + escape(title) + "</h1>" + escape(content).replace(/\n/g, "<br>") + "</body></html>");
  win.document.close(); win.focus(); win.print();
}

export function CreationChat({ runtime }: { runtime: boolean }) {
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [imageSettings, setImageSettings] = useState<ImageSettings>(initialImageSettings);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!runtime) return;
    void invoke<Model[]>("list_ollama_models").then(items => {
      setModels(items);
      let saved = "";
      try { saved = JSON.parse(localStorage.getItem("nexus.ai.settings") || "{}").model || ""; } catch { /* settings may be invalid */ }
      setModel(items.find(item => item.name === saved)?.name ?? items[0]?.name ?? "");
    }).catch(() => setError("Ollama est indisponible. Vérifie que le service local est démarré."));
  }, [runtime]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy) return;
    if (!runtime || !model) { setError("Le chat nécessite l’application de bureau et un modèle Ollama installé."); return; }

    const userItem: ChatItem = { id: Date.now(), role: "user", text: prompt };
    const history = [...messages, userItem].slice(-20);
    setMessages(history);
    setDraft("");
    setBusy(true);
    setError("");

    const wantsImage = /\b(image|illustration|affiche|logo|dessin|visuel|génère-moi une image|genere moi une image)\b/i.test(prompt);
    const wantsFile = /\b(pdf|\.md|markdown|fiche|cours|document|lettre|rapport|cv|tableau|fichier|exporte|génère|genere|crée|cree|prépare|prepare)\b/i.test(prompt);

    try {
      if (wantsImage) {
        if (!imageSettings.key.trim()) {
          setShowSettings(true);
          throw new Error("Pour créer une image, configure le fournisseur dans « Paramètres de création » puis renvoie ta demande. La génération d’images nécessite un service compatible et une clé API.");
        }
        const response = await fetch(imageSettings.endpoint.trim(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + imageSettings.key.trim() },
          body: JSON.stringify({ model: imageSettings.model.trim(), prompt, size: imageSettings.size, n: 1 }),
        });
        const data = await response.json().catch(() => ({})) as { data?: Array<{ url?: string; b64_json?: string }>; error?: { message?: string } | string };
        if (!response.ok) {
          const detail = typeof data.error === "string" ? data.error : data.error?.message;
          throw new Error(detail || ("Le service d’image a répondu HTTP " + response.status + ". Vérifie le fournisseur et l’accès réseau."));
        }
        const item = data.data?.[0];
        const image = item?.b64_json ? "data:image/png;base64," + item.b64_json : item?.url;
        if (!image) throw new Error("Le fournisseur n’a retourné aucune image exploitable.");
        setMessages(current => [...current, { id: Date.now() + 1, role: "assistant", text: "Voici l’image créée à partir de ta demande.", image }]);
      } else {
        const system = wantsFile
          ? "Tu es l’assistant de création de NEXUS CONTROL. Rédige directement le contenu complet, propre et prêt à l’emploi demandé par l’utilisateur. En français sauf demande contraire. N’invente pas les informations absentes : indique [À compléter]. Si l’utilisateur demande une fiche ou un cours, structure avec titre, objectifs, sections, exemples et exercices si pertinent. Retourne uniquement le contenu final, sans commentaire sur ta méthode."
          : "Tu es l’assistant IA de NEXUS CONTROL. Réponds clairement en français, avec Markdown utile. Si l’utilisateur demande une action que tu ne peux pas réellement exécuter, explique la limite au lieu de prétendre l’avoir faite.";
        const answer = await invoke<string>("ollama_chat", {
          model,
          messages: [
            { role: "system", content: system },
            ...history.map(item => ({ role: item.role, content: item.text })),
          ],
        });
        const isPdf = /\bpdf\b/i.test(prompt);
        const isMarkdown = /\.md\b|markdown|fiche/i.test(prompt);
        const format = isPdf ? "pdf" : isMarkdown ? "md" : wantsFile ? "md" : "";
        const titleMatch = prompt.match(/(?:de|du|sur|pour|intitulé|intitule)\s+(.{3,80})/i);
        const title = titleMatch?.[1]?.replace(/[?.!].*$/, "").trim() || (isPdf ? "Document PDF" : "Création NEXUS CONTROL");
        setMessages(current => [...current, {
          id: Date.now() + 1,
          role: "assistant",
          text: answer,
          ...(format ? { file: { name: safeName(title), content: answer, format } } : {}),
        }]);
      }
    } catch (cause) {
      setError(String(cause).replace(/^Error: /, ""));
    } finally {
      setBusy(false);
    }
  }

  async function downloadImage(image: string) {
    try {
      const response = await fetch(image);
      if (!response.ok) throw new Error("Téléchargement refusé");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "nexus-image." + ((blob.type.split("/")[1] || "png").split(";")[0]); anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      setError("Impossible de télécharger l’image depuis cette adresse. Vérifie les droits d’accès du fournisseur.");
    }
  }

  function downloadFile(file: NonNullable<ChatItem["file"]>) {
    if (file.format === "pdf") { savePdf(file.name, file.content); return; }
    downloadText(file.name + ".md", file.content, "text/markdown;charset=utf-8");
  }

  return (
    <section className="page-body creation-chat-page">
      <div className="creation-chat-shell">
        <header className="creation-chat-header">
          <div className="creation-brand-icon"><Sparkles size={21}/></div>
          <div className="creation-header-copy"><strong>Assistant IA</strong><span>{model ? model + " · modèle local" : "Recherche du modèle local…"} · création de fichiers dans le chat</span></div>
          <button className="creation-settings-toggle" type="button" onClick={() => setShowSettings(value => !value)} aria-expanded={showSettings}><Settings2 size={16}/><span>Paramètres de création</span></button>
        </header>

        {showSettings && <section className="creation-settings">
          <div className="creation-settings-title"><div><strong>Génération d’images</strong><span>Ces réglages ne sont nécessaires que pour les demandes d’images.</span></div><button type="button" onClick={() => setShowSettings(false)} aria-label="Fermer les paramètres"><X size={16}/></button></div>
          <label>URL du service<input value={imageSettings.endpoint} onChange={e => setImageSettings(v => ({ ...v, endpoint: e.target.value }))} placeholder="URL API compatible"/></label>
          <div className="creation-settings-grid"><label>Modèle d’image<input value={imageSettings.model} onChange={e => setImageSettings(v => ({ ...v, model: e.target.value }))}/></label><label>Dimensions<select value={imageSettings.size} onChange={e => setImageSettings(v => ({ ...v, size: e.target.value }))}><option value="1024x1024">Carré</option><option value="1536x1024">Paysage</option><option value="1024x1536">Portrait</option></select></label></div>
          <label>Clé API (gardée en mémoire tant que la page est ouverte)<input type="password" autoComplete="off" value={imageSettings.key} onChange={e => setImageSettings(v => ({ ...v, key: e.target.value }))} placeholder="Clé du fournisseur d’images"/></label>
        </section>}

        <div className="creation-chat-transcript" aria-live="polite">
          {messages.length === 0 && <div className="creation-welcome">
            <div className="creation-welcome-icon"><Sparkles size={26}/></div>
            <h2>Qu’est-ce qu’on crée aujourd’hui ?</h2>
            <p>Écris simplement ta demande. Je peux répondre, rédiger un cours ou une fiche, puis te proposer le fichier à enregistrer.</p>
            <div className="creation-examples">
              <button type="button" onClick={() => setDraft("Fais-moi un PDF du cours de mathématiques sur les suites en Terminale.")}><FileText size={16}/> Un cours en PDF</button>
              <button type="button" onClick={() => setDraft("Crée une fiche de révision en Markdown sur les fonctions dérivées.")}><FileText size={16}/> Une fiche Markdown</button>
              <button type="button" onClick={() => setDraft("Crée une affiche illustrée pour annoncer les inscriptions scolaires.")}><ImagePlus size={16}/> Une image / affiche</button>
            </div>
          </div>}
          {messages.map(item => <article className={"creation-message " + (item.role === "user" ? "creation-message-user" : "creation-message-assistant")} key={item.id}>
            <div className="creation-message-avatar">{item.role === "user" ? <UserRound size={16}/> : <Bot size={17}/>}</div>
            <div className="creation-message-body"><div className="creation-message-author">{item.role === "user" ? "Toi" : "Assistant IA"}</div>
              <div className="creation-message-text">{item.text}</div>
              {item.image && <div className="creation-image-result"><img src={item.image} alt="Image générée"/><button type="button" onClick={() => void downloadImage(item.image!)}><Download size={15}/> Télécharger l’image</button></div>}
              {item.file && <div className="creation-file-card"><div className="creation-file-icon"><FileText size={22}/></div><div className="creation-file-meta"><strong>{item.file.name}.{item.file.format === "pdf" ? "pdf" : "md"}</strong><span>{item.file.format === "pdf" ? "Document prêt à imprimer / enregistrer en PDF" : "Fichier Markdown prêt à enregistrer"}</span></div><button type="button" onClick={() => downloadFile(item.file!)}><Download size={15}/>{item.file.format === "pdf" ? "Créer le PDF" : "Télécharger .md"}</button></div>}
            </div>
          </article>)}
          {busy && <div className="creation-message creation-message-assistant"><div className="creation-message-avatar"><Bot size={17}/></div><div className="creation-message-body"><div className="creation-message-author">Assistant IA</div><div className="creation-thinking"><LoaderCircle size={17}/><span>Je prépare le résultat…</span><i/><i/><i/></div></div></div>}
          <div ref={bottomRef}/>
        </div>

        {error && <div className="creation-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Fermer">×</button></div>}
        <form className="creation-composer" onSubmit={submit}>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Écris ta demande : « Fais-moi un PDF du cours de… »" rows={2} maxLength={12000} disabled={busy} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/>
          <div className="creation-composer-footer"><span><Paperclip size={14}/> Documents, fiches, PDF et images depuis le même chat</span><button type="submit" disabled={!draft.trim() || busy || !model}><Send size={16}/>{busy ? "En cours…" : "Envoyer"}</button></div>
        </form>
        <p className="creation-chat-footnote"><Check size={13}/> Les textes sont générés localement avec Ollama. Les images nécessitent un fournisseur d’images configuré.</p>
      </div>
    </section>
  );
}
