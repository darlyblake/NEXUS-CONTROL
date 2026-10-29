import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import * as XLSX from "xlsx";
import PptxGenJS from "pptxgenjs";
import { jsPDF } from "jspdf";
import { Bot, Check, Download, FileText, ImagePlus, LoaderCircle, Paperclip, Send, Settings2, Sparkles, UserRound, X } from "lucide-react";
import "./CreationChat.css";

type Model = { name: string; size?: number };
type ExportFormat = "pdf" | "docx" | "xlsx" | "pptx" | "md";
type ChatItem = { id: number; role: "user" | "assistant"; text: string; file?: { name: string; content: string; format: ExportFormat }; image?: string };
type ImageSettings = { endpoint: string; model: string; key: string; size: string };
const initialImageSettings: ImageSettings = { endpoint: "https://api.openai.com/v1/images/generations", model: "gpt-image-1", key: "", size: "1024x1024" };

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "creation";
}
function saveBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function plainLines(content: string) {
  return content.replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean);
}
function spreadsheetRows(content: string): string[][] {
  const lines = plainLines(content);
  const tableLines = lines.filter(line => /^\|.*\|$/.test(line));
  if (tableLines.length >= 2) {
    return tableLines.filter(line => !/^\|[\s:|-]+\|$/.test(line)).map(line => line.slice(1, -1).split("|").map(cell => cell.trim()));
  }
  return [["Contenu"], ...lines.map(line => [line.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s*/, "")])];
}
function titleFromContent(content: string) {
  return plainLines(content).find(line => line.startsWith("# "))?.replace(/^#\s*/, "") || "Document NEXUS CONTROL";
}
async function exportDocument(file: NonNullable<ChatItem["file"]>) {
  const title = titleFromContent(file.content) || file.name;
  if (file.format === "md") {
    saveBlob(file.name + ".md", new Blob([file.content], { type: "text/markdown;charset=utf-8" }));
    return;
  }
  if (file.format === "pdf") {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 18, width = 174;
    let y = 20;
    for (const line of file.content.replace(/\r/g, "").split("\n")) {
      const isHeading = /^#{1,2}\s/.test(line);
      const text = line.replace(/^#{1,6}\s*/, "").replace(/^[-*]\s*/, "• ");
      pdf.setFont("helvetica", isHeading ? "bold" : "normal");
      pdf.setFontSize(isHeading ? 15 : 10.5);
      const wrapped = pdf.splitTextToSize(text || " ", width);
      const lineHeight = isHeading ? 8 : 5.5;
      if (y + wrapped.length * lineHeight > 278) { pdf.addPage(); y = 20; }
      pdf.text(wrapped, margin, y);
      y += wrapped.length * lineHeight + (isHeading ? 3 : 1);
    }
    pdf.save(file.name + ".pdf");
    return;
  }
  if (file.format === "docx") {
    const paragraphs = file.content.replace(/\r/g, "").split("\n").map(line => {
      const heading = /^(#{1,3})\s+(.*)$/.exec(line);
      if (heading) {
        const level = heading[1].length === 1 ? HeadingLevel.HEADING_1 : heading[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
        return new Paragraph({ text: heading[2], heading: level, spacing: { before: 180, after: 100 } });
      }
      const bullet = /^\s*[-*]\s+/.test(line);
      return new Paragraph({ children: [new TextRun(line.replace(/^\s*[-*]\s+/, ""))], bullet: bullet ? { level: 0 } : undefined, spacing: { after: 90 } });
    });
    const doc = new Document({ sections: [{ properties: {}, children: [new Paragraph({ text: title, heading: HeadingLevel.TITLE }), ...paragraphs] }] });
    saveBlob(file.name + ".docx", await Packer.toBlob(doc));
    return;
  }
  if (file.format === "xlsx") {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(spreadsheetRows(file.content));
    sheet["!cols"] = [{ wch: 34 }, { wch: 24 }, { wch: 24 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(workbook, sheet, "Données");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveBlob(file.name + ".xlsx", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    return;
  }
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "NEXUS CONTROL";
  const chunks: { heading: string; body: string[] }[] = [];
  for (const line of file.content.replace(/\r/g, "").split("\n")) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading || chunks.length === 0) chunks.push({ heading: heading?.[2] || title, body: [] });
    else if (line.trim()) chunks[chunks.length - 1].body.push(line.replace(/^\s*[-*]\s*/, "• "));
  }
  for (const chunk of chunks) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(chunk.heading, { x: 0.65, y: 0.45, w: 12, h: 0.65, fontFace: "Aptos Display", fontSize: 25, bold: true, color: "244A83" });
    slide.addText(chunk.body.join("\n"), { x: 0.8, y: 1.45, w: 11.6, h: 5.1, fontFace: "Aptos", fontSize: 17, color: "26364D", breakLine: false, paraSpaceAfter: 12, valign: "top", fit: "shrink" });
    slide.addText("NEXUS CONTROL", { x: 10.6, y: 7.05, w: 2, h: 0.2, fontSize: 8, color: "8290A3", align: "right" });
  }
  await pptx.writeFile({ fileName: file.name + ".pptx" });
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
      try { saved = JSON.parse(localStorage.getItem("nexus.ai.settings") || "{}").model || ""; } catch { /* paramètres locaux invalides */ }
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
    setMessages(history); setDraft(""); setBusy(true); setError("");
    const wantsImage = /\b(image|illustration|affiche|logo|dessin|visuel|génère-moi une image|genere moi une image)\b/i.test(prompt);
    const wantsFile = /\b(pdf|word|docx|excel|xlsx|powerpoint|pptx|\.md|markdown|fiche|cours|document|lettre|rapport|cv|tableau|fichier|exporte|génère|genere|crée|cree|prépare|prepare)\b/i.test(prompt);
    try {
      if (wantsImage) {
        if (!imageSettings.key.trim()) {
          setShowSettings(true);
          throw new Error("Pour créer une image, configure le fournisseur dans « Paramètres de création » puis renvoie ta demande. La génération d’images nécessite un service compatible et une clé API.");
        }
        const response = await fetch(imageSettings.endpoint.trim(), { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + imageSettings.key.trim() }, body: JSON.stringify({ model: imageSettings.model.trim(), prompt, size: imageSettings.size, n: 1 }) });
        const data = await response.json().catch(() => ({})) as { data?: Array<{ url?: string; b64_json?: string }>; error?: { message?: string } | string };
        if (!response.ok) { const detail = typeof data.error === "string" ? data.error : data.error?.message; throw new Error(detail || ("Le service d’image a répondu HTTP " + response.status + ".")); }
        const item = data.data?.[0];
        const image = item?.b64_json ? "data:image/png;base64," + item.b64_json : item?.url;
        if (!image) throw new Error("Le fournisseur n’a retourné aucune image exploitable.");
        setMessages(current => [...current, { id: Date.now() + 1, role: "assistant", text: "Voici l’image créée à partir de ta demande.", image }]);
      } else {
        const kind = /\b(excel|xlsx|tableur|feuille de calcul)\b/i.test(prompt) ? "tableur Excel" : /\b(powerpoint|pptx|présentation|diaporama)\b/i.test(prompt) ? "présentation PowerPoint" : /\b(word|docx|document word)\b/i.test(prompt) ? "document Word" : /\b(pdf)\b/i.test(prompt) ? "document PDF" : "document";
        const system = wantsFile
          ? "Tu es l’assistant de création de NEXUS CONTROL. Rédige le contenu complet, soigné et prêt à l’emploi en français sauf demande contraire. N’invente pas les informations absentes : indique [À compléter]. Utilise Markdown structuré avec titres #, ##, listes et tableaux Markdown. Pour un tableur Excel, produis principalement un tableau Markdown avec des en-têtes explicites et des lignes de données cohérentes. Pour un PowerPoint, organise le contenu en 5 à 10 diapositives avec un titre # ou ## par diapositive et 3 à 5 points courts par diapositive. Pour Word/PDF, produis un document structuré avec titre, sections et exemples utiles. Retourne uniquement le contenu final."
          : "Tu es l’assistant IA de NEXUS CONTROL. Réponds clairement en français, avec Markdown utile. Si l’utilisateur demande une action que tu ne peux pas réellement exécuter, explique la limite.";
        const answer = await invoke<string>("ollama_chat", { model, messages: [{ role: "system", content: system + " Type demandé : " + kind + "." }, ...history.map(item => ({ role: item.role, content: item.text }))] });
        const format: ExportFormat | undefined = /\b(excel|xlsx|tableur|feuille de calcul)\b/i.test(prompt) ? "xlsx" : /\b(powerpoint|pptx|présentation|diaporama)\b/i.test(prompt) ? "pptx" : /\b(word|docx|document word)\b/i.test(prompt) ? "docx" : /\b(pdf)\b/i.test(prompt) ? "pdf" : wantsFile ? "docx" : undefined;
        const titleMatch = prompt.match(/(?:de|du|sur|pour|intitulé|intitule)\s+(.{3,80})/i);
        const title = safeName(titleMatch?.[1]?.replace(/[?.!].*$/, "").trim() || titleFromContent(answer));
        setMessages(current => [...current, { id: Date.now() + 1, role: "assistant", text: answer, ...(format ? { file: { name: title, content: answer, format } } : {}) }]);
      }
    } catch (cause) { setError(String(cause).replace(/^Error: /, "")); }
    finally { setBusy(false); }
  }

  async function downloadImage(image: string) {
    try {
      const response = await fetch(image);
      if (!response.ok) throw new Error("Téléchargement refusé");
      const blob = await response.blob();
      const extension = (blob.type.split("/")[1] || "png").split(";")[0];
      saveBlob("nexus-image." + extension, blob);
    } catch { setError("Impossible de télécharger l’image depuis cette adresse. Vérifie les droits d’accès du fournisseur."); }
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
          <div className="creation-settings-title"><div><strong>Génération d’images</strong><span>Les documents Office et PDF sont créés localement. Seules les images nécessitent un fournisseur externe.</span></div><button type="button" onClick={() => setShowSettings(false)} aria-label="Fermer les paramètres"><X size={16}/></button></div>
          <label>URL du service<input value={imageSettings.endpoint} onChange={e => setImageSettings(v => ({ ...v, endpoint: e.target.value }))} placeholder="URL API compatible"/></label>
          <div className="creation-settings-grid"><label>Modèle d’image<input value={imageSettings.model} onChange={e => setImageSettings(v => ({ ...v, model: e.target.value }))}/></label><label>Dimensions<select value={imageSettings.size} onChange={e => setImageSettings(v => ({ ...v, size: e.target.value }))}><option value="1024x1024">Carré</option><option value="1536x1024">Paysage</option><option value="1024x1536">Portrait</option></select></label></div>
          <label>Clé API (gardée en mémoire tant que la page est ouverte)<input type="password" autoComplete="off" value={imageSettings.key} onChange={e => setImageSettings(v => ({ ...v, key: e.target.value }))} placeholder="Clé du fournisseur d’images"/></label>
        </section>}
        <div className="creation-chat-transcript" aria-live="polite">
          {messages.length === 0 && <div className="creation-welcome">
            <div className="creation-welcome-icon"><Sparkles size={26}/></div><h2>Qu’est-ce qu’on crée aujourd’hui ?</h2>
            <p>Demande un fichier PDF, Word, Excel ou PowerPoint. Le document est généré localement et proposé au téléchargement dans le chat.</p>
            <div className="creation-examples">
              <button type="button" onClick={() => setDraft("Fais-moi un PDF du cours de mathématiques sur les suites en Terminale.")}><FileText size={16}/> Un cours en PDF</button>
              <button type="button" onClick={() => setDraft("Crée un document Word avec une fiche de révision sur les fonctions dérivées.")}><FileText size={16}/> Un document Word</button>
              <button type="button" onClick={() => setDraft("Crée un tableau Excel de suivi des notes des élèves.")}><FileText size={16}/> Un tableau Excel</button>
              <button type="button" onClick={() => setDraft("Prépare une présentation PowerPoint sur la sécurité informatique.")}><FileText size={16}/> Un PowerPoint</button>
              <button type="button" onClick={() => setDraft("Crée une affiche illustrée pour annoncer les inscriptions scolaires.")}><ImagePlus size={16}/> Une image / affiche</button>
            </div>
          </div>}
          {messages.map(item => <article className={"creation-message " + (item.role === "user" ? "creation-message-user" : "creation-message-assistant")} key={item.id}>
            <div className="creation-message-avatar">{item.role === "user" ? <UserRound size={16}/> : <Bot size={17}/>}</div>
            <div className="creation-message-body"><div className="creation-message-author">{item.role === "user" ? "Toi" : "Assistant IA"}</div>
              <div className="creation-message-text">{item.text}</div>
              {item.image && <div className="creation-image-result"><img src={item.image} alt="Image générée"/><button type="button" onClick={() => void downloadImage(item.image!)}><Download size={15}/> Télécharger l’image</button></div>}
              {item.file && <div className="creation-file-card"><div className="creation-file-icon"><FileText size={22}/></div><div className="creation-file-meta"><strong>{item.file.name}.{item.file.format}</strong><span>{({ pdf: "PDF prêt à télécharger", docx: "Document Microsoft Word", xlsx: "Classeur Microsoft Excel", pptx: "Présentation Microsoft PowerPoint", md: "Document Markdown" })[item.file.format]}</span></div><button type="button" onClick={() => void exportDocument(item.file!).catch(cause => setError("La création du fichier a échoué : " + String(cause)))}><Download size={15}/> Télécharger</button></div>}
            </div>
          </article>)}
          {busy && <div className="creation-message creation-message-assistant"><div className="creation-message-avatar"><Bot size={17}/></div><div className="creation-message-body"><div className="creation-message-author">Assistant IA</div><div className="creation-thinking"><LoaderCircle size={17}/><span>Je prépare le résultat…</span><i/><i/><i/></div></div></div>}
          <div ref={bottomRef}/>
        </div>
        {error && <div className="creation-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Fermer">×</button></div>}
        <form className="creation-composer" onSubmit={submit}>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ex. : Crée un document Word, un tableau Excel ou un PowerPoint…" rows={2} maxLength={12000} disabled={busy} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/>
          <div className="creation-composer-footer"><span><Paperclip size={14}/> PDF · Word · Excel · PowerPoint · Images</span><button type="submit" disabled={!draft.trim() || busy || !model}><Send size={16}/>{busy ? "En cours…" : "Envoyer"}</button></div>
        </form>
        <p className="creation-chat-footnote"><Check size={13}/> Les documents sont fabriqués sur cet ordinateur. La création d’images utilise le fournisseur configuré.</p>
      </div>
    </section>
  );
}
