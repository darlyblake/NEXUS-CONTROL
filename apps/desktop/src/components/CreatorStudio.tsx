import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen, Check, Clipboard, Download, FileImage, FileText, ImagePlus, LoaderCircle,
  Printer, RefreshCw, Sparkles, WandSparkles
} from "lucide-react";
import "./CreatorStudio.css";

type Model = { name: string; size?: number };
type DocumentFormat = "txt" | "md" | "html" | "doc" | "rtf" | "csv" | "json";

const FORMAT_LABELS: Record<DocumentFormat, string> = {
  txt: "Texte (.txt)", md: "Markdown (.md)", html: "Page web (.html)",
  doc: "Word compatible (.doc)", rtf: "Texte enrichi (.rtf)", csv: "Tableur (.csv)", json: "Données (.json)"
};
const TEMPLATE_HINTS: Record<string, string> = {
  libre: "Document libre", lettre: "Lettre administrative ou professionnelle", rapport: "Rapport structuré avec introduction, développement et conclusion",
  cours: "Cours pédagogique avec objectifs, explications et exercices", cv: "CV professionnel clair et bien structuré",
  reunion: "Compte rendu de réunion avec décisions et actions", facture: "Facture avec émetteur, client, lignes, montants et total",
  tableau: "Tableau de données clair, avec en-têtes cohérents", presentation: "Plan de présentation avec diapositives et points clés"
};

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function downloadBlob(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function safeFileName(value: string) {
  return (value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "document");
}
function makeRtf(value: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\r?\n/g, "\\par\n");
  return "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0\\fs22 " + escaped + "}";
}
function openPrintView(title: string, content: string) {
  const win = window.open("", "_blank");
  if (!win) { window.alert("Autorise l’ouverture de fenêtre pour créer le PDF via l’impression."); return; }
  win.document.open();
  win.document.write("<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>" + escapeHtml(title) + "</title><style>body{font:12pt Arial,sans-serif;line-height:1.55;color:#182230;max-width:800px;margin:35px auto;padding:0 24px;white-space:pre-wrap}h1{font-size:20pt}@media print{body{margin:15mm auto}}</style></head><body><h1>" + escapeHtml(title) + "</h1>" + escapeHtml(content).replace(/\n/g, "<br>") + "</body></html>");
  win.document.close(); win.focus(); win.print();
}

export function CreatorStudio({ runtime }: { runtime: boolean }) {
  const [tab, setTab] = useState<"document" | "image">("document");
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [template, setTemplate] = useState("rapport");
  const [title, setTitle] = useState("Mon document");
  const [prompt, setPrompt] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<DocumentFormat>("md");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageEndpoint, setImageEndpoint] = useState("https://api.openai.com/v1/images/generations");
  const [imageModel, setImageModel] = useState("gpt-image-1");
  const [imageKey, setImageKey] = useState("");
  const [imageSize, setImageSize] = useState("1024x1024");
  const [imageResult, setImageResult] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");

  useEffect(() => {
    if (!runtime) return;
    void invoke<Model[]>("list_ollama_models").then(items => {
      setModels(items);
      let saved = "";
      try { saved = JSON.parse(localStorage.getItem("nexus.ai.settings") || "{}").model || ""; } catch { /* ignore invalid local settings */ }
      setModel(items.find(item => item.name === saved)?.name ?? items[0]?.name ?? "");
    }).catch(() => setMessage("Ollama indisponible : tu peux toujours écrire et exporter un document manuellement."));
  }, [runtime]);

  async function generateDocument() {
    if (!prompt.trim()) { setMessage("Décris le document à créer."); return; }
    if (!runtime || !model) { setMessage("Le modèle local Ollama n’est pas disponible. Saisis le contenu manuellement ou vérifie Ollama."); return; }
    setBusy(true); setMessage("");
    try {
      const answer = await invoke<string>("ollama_chat", {
        model,
        messages: [
          { role: "system", content: "Tu es un assistant professionnel de rédaction en français. Génère le document demandé directement, prêt à être utilisé. Respecte le type de document, les informations fournies, une structure claire et une orthographe soignée. N'invente pas les données manquantes : indique [À compléter]. Si un tableau est utile, écris un tableau Markdown valide. Ne donne pas de commentaire sur ta méthode, fournis seulement le document." },
          { role: "user", content: "Type : " + (TEMPLATE_HINTS[template] || TEMPLATE_HINTS.libre) + "\nTitre souhaité : " + title + "\nConsignes :\n" + prompt }
        ]
      });
      setContent(answer); setMessage("Document généré avec " + model + ". Relis-le avant de l’utiliser.");
    } catch (error) { setMessage("Échec de génération : " + String(error)); }
    finally { setBusy(false); }
  }

  function exportDocument() {
    if (!content.trim()) { setMessage("Ajoute ou génère d’abord un contenu."); return; }
    const name = safeFileName(title);
    const mime: Record<DocumentFormat, string> = {
      txt: "text/plain;charset=utf-8", md: "text/markdown;charset=utf-8", html: "text/html;charset=utf-8",
      doc: "application/msword", rtf: "application/rtf", csv: "text/csv;charset=utf-8", json: "application/json;charset=utf-8"
    };
    let output = content;
    if (format === "html" || format === "doc") {
      output = "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>" + escapeHtml(title) + "</title><style>body{font:12pt Arial,sans-serif;line-height:1.5;margin:2cm;color:#172033}h1{color:#244a83}pre{white-space:pre-wrap}</style></head><body><h1>" + escapeHtml(title) + "</h1><pre style=\"font:inherit;white-space:pre-wrap\">" + escapeHtml(content) + "</pre></body></html>";
    } else if (format === "rtf") output = makeRtf(title + "\n\n" + content);
    else if (format === "json") output = JSON.stringify({ title, content, generatedAt: new Date().toISOString() }, null, 2);
    else if (format === "csv") output = "\uFEFF" + content;
    downloadBlob(name + "." + format, output, mime[format]);
    setMessage("Export téléchargé : " + name + "." + format);
  }

  async function generateImage() {
    if (!imagePrompt.trim()) { setImageError("Décris l’image souhaitée."); return; }
    if (!imageEndpoint.trim() || !imageModel.trim() || !imageKey.trim()) { setImageError("Renseigne l’URL du service, le modèle et la clé API."); return; }
    setImageBusy(true); setImageError(""); setImageResult("");
    try {
      const response = await fetch(imageEndpoint.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + imageKey.trim() },
        body: JSON.stringify({ model: imageModel.trim(), prompt: imagePrompt.trim(), size: imageSize, n: 1 })
      });
      const data = await response.json().catch(() => ({})) as { data?: Array<{ url?: string; b64_json?: string }>; error?: { message?: string } | string };
      if (!response.ok) {
        const detail = typeof data.error === "string" ? data.error : data.error?.message;
        throw new Error(detail || ("HTTP " + response.status + ". Vérifie le fournisseur et son accès CORS."));
      }
      const item = data.data?.[0];
      if (item?.b64_json) setImageResult("data:image/png;base64," + item.b64_json);
      else if (item?.url) setImageResult(item.url);
      else throw new Error("Réponse reçue sans image. Le service doit retourner data[0].url ou data[0].b64_json.");
    } catch (error) {
      setImageError(String(error) + " La clé API reste uniquement en mémoire dans cette page et n’est pas enregistrée.");
    } finally { setImageBusy(false); }
  }

  async function downloadImage() {
    if (!imageResult) return;
    try {
      const response = await fetch(imageResult);
      const blob = await response.blob();
      downloadBlob("nexus-image.png", blob, blob.type || "image/png");
    } catch { setImageError("Téléchargement impossible depuis cette URL. Ouvre l’image dans un nouvel onglet ou vérifie les droits du fournisseur."); }
  }

  return (
    <section className="page-body creator-page">
      <div className="creator-intro">
        <div className="creator-intro-icon"><WandSparkles size={22}/></div>
        <div><span className="creator-eyebrow">ATELIER DE CRÉATION</span><h2>Documents et images</h2><p>Rédige avec ton modèle local, exporte dans plusieurs formats et génère des images avec un service compatible.</p></div>
      </div>
      <div className="creator-tabs" role="tablist" aria-label="Type de création">
        <button type="button" className={tab === "document" ? "selected" : ""} onClick={() => setTab("document")}><FileText size={16}/> Documents</button>
        <button type="button" className={tab === "image" ? "selected" : ""} onClick={() => setTab("image")}><ImagePlus size={16}/> Images</button>
      </div>

      {tab === "document" ? <div className="creator-layout">
        <section className="creator-panel">
          <div className="creator-panel-heading"><BookOpen size={17}/><div><h3>Créer un document</h3><p>Le modèle local rédige le contenu ; tu peux ensuite le corriger.</p></div></div>
          <label>Type de document<select value={template} onChange={e => setTemplate(e.target.value)}>{Object.entries(TEMPLATE_HINTS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Titre du document<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex. Rapport de stage"/></label>
          <label>Consignes et informations<textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={5} placeholder="Décris le sujet, le destinataire, les dates, les noms, le ton et les informations à inclure…"/></label>
          <label>Modèle IA local<select value={model} onChange={e => setModel(e.target.value)} disabled={!models.length}><option value="">{models.length ? "Choisir un modèle" : "Ollama non détecté"}</option>{models.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
          <button type="button" className="creator-primary" onClick={() => void generateDocument()} disabled={busy || !prompt.trim()}>{busy ? <LoaderCircle className="creator-spin" size={16}/> : <Sparkles size={16}/>} {busy ? "Génération en cours…" : "Générer le document"}</button>
          {message && <p className="creator-status" role="status">{message}</p>}
        </section>
        <section className="creator-panel creator-output-panel">
          <div className="creator-panel-heading"><FileText size={17}/><div><h3>Contenu et export</h3><p>Modifie le résultat avant de le télécharger.</p></div></div>
          <textarea className="creator-document-editor" aria-label="Contenu du document" value={content} onChange={e => setContent(e.target.value)} placeholder="Le document généré apparaîtra ici. Tu peux aussi saisir ou coller ton texte." rows={17}/>
          <div className="creator-export-row"><label>Format d’export<select value={format} onChange={e => setFormat(e.target.value as DocumentFormat)}>{Object.entries(FORMAT_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}<option value="pdf">PDF (impression)</option></select></label><button type="button" className="creator-primary" onClick={() => format === ("pdf" as DocumentFormat) ? openPrintView(title, content) : exportDocument()} disabled={!content.trim()}>{format === ("pdf" as DocumentFormat) ? <Printer size={16}/> : <Download size={16}/>} Exporter</button></div>
          <p className="creator-small-note">PDF : la fenêtre d’impression du système permet de choisir « Enregistrer au format PDF ». Le format Word .doc est compatible HTML, pas un fichier .docx natif.</p>
        </section>
      </div> : <div className="creator-layout creator-image-layout">
        <section className="creator-panel">
          <div className="creator-panel-heading"><FileImage size={17}/><div><h3>Générateur d’images</h3><p>Utilise un service d’images compatible avec l’API OpenAI.</p></div></div>
          <label>Description de l’image<textarea value={imagePrompt} onChange={e => setImagePrompt(e.target.value)} rows={5} placeholder="Ex. Illustration professionnelle bleue et blanche d’un réseau d’ordinateurs, style moderne, sans texte…"/></label>
          <label>URL complète de l’API<input value={imageEndpoint} onChange={e => setImageEndpoint(e.target.value)} placeholder="https://fournisseur.example/v1/images/generations"/></label>
          <label>Modèle d’image<input value={imageModel} onChange={e => setImageModel(e.target.value)} placeholder="Nom du modèle fourni par ton service"/></label>
          <label>Clé API (non enregistrée)<input type="password" autoComplete="off" value={imageKey} onChange={e => setImageKey(e.target.value)} placeholder="Clé API du fournisseur"/></label>
          <label>Dimensions<select value={imageSize} onChange={e => setImageSize(e.target.value)}><option value="1024x1024">Carrée — 1024 × 1024</option><option value="1536x1024">Paysage — 1536 × 1024</option><option value="1024x1536">Portrait — 1024 × 1536</option></select></label>
          <button type="button" className="creator-primary" onClick={() => void generateImage()} disabled={imageBusy || !imagePrompt.trim()}>{imageBusy ? <LoaderCircle className="creator-spin" size={16}/> : <ImagePlus size={16}/>} {imageBusy ? "Génération en cours…" : "Générer l’image"}</button>
          {imageError && <p className="creator-error" role="alert">{imageError}</p>}
          <p className="creator-small-note">Nécessite un fournisseur, un modèle et une clé API compatibles. L’URL doit accepter les requêtes de l’application (CORS). Les coûts éventuels dépendent du fournisseur.</p>
        </section>
        <section className="creator-panel creator-image-output">
          <div className="creator-panel-heading"><ImagePlus size={17}/><div><h3>Résultat de l’image</h3><p>Affiche puis télécharge l’image générée.</p></div></div>
          {imageResult ? <><img className="creator-generated-image" src={imageResult} alt="Image générée par le service configuré"/><div className="creator-export-row"><button type="button" className="creator-secondary" onClick={() => window.open(imageResult, "_blank", "noopener,noreferrer")}>Ouvrir l’image</button><button type="button" className="creator-primary" onClick={() => void downloadImage()}><Download size={16}/> Télécharger PNG</button></div></> : <div className="creator-image-empty"><ImagePlus size={34}/><strong>Aucune image générée</strong><span>Décris ton image et configure le service pour commencer.</span></div>}
        </section>
      </div>}
    </section>
  );
}
