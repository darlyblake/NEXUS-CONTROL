import { useState } from "react";
import { Code2, Copy, Play, RotateCcw, Eye, Pencil } from "lucide-react";
import "./HTMLRunner.css";

type Props = { initialCode: string };

const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' data:",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function makeDocument(source: string): string {
  const csp = '<meta http-equiv="Content-Security-Policy" content="' + PREVIEW_CSP + '">';
  if (/<html[\\s>]/i.test(source)) {
    if (/<head(?:\\s[^>]*)?>/i.test(source)) {
      return source.replace(/<head([^>]*)>/i, (_match, attrs) => '<head' + attrs + '>' + csp);
    }
    if (/<body(?:\\s[^>]*)?>/i.test(source)) {
      return source.replace(/<body(?:\\s[^>]*)?>/i, match => '<head>' + csp + '</head>' + match);
    }
    return source.replace(/<html([^>]*)>/i, match => match + '<head>' + csp + '</head>');
  }
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' + csp + '</head><body>' + source + '</body></html>';
}

export function HTMLRunner({ initialCode }: Props) {
  const [code, setCode] = useState(initialCode);
  const [previewCode, setPreviewCode] = useState(initialCode);
  const [view, setView] = useState<"preview" | "code">("preview");
  const [status, setStatus] = useState("Aperçu isolé");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("Code copié");
    } catch {
      setStatus("Copie indisponible dans cet environnement");
    }
  }

  function runCode() {
    setPreviewCode(code);
    setView("preview");
    setStatus("Aperçu actualisé");
  }

  function resetCode() {
    setCode(initialCode);
    setPreviewCode(initialCode);
    setView("preview");
    setStatus("Code initial restauré");
  }

  return (
    <section className="html-runner" aria-label="Exécuteur HTML isolé">
      <header className="html-runner-header">
        <div className="html-runner-title"><Code2 size={15} /><strong>Exécuteur HTML</strong><span className="html-runner-badge">Isolé</span></div>
        <div className="html-runner-actions">
          <button type="button" onClick={() => setView("code")} className={view === "code" ? "active" : ""}><Pencil size={13} /> Code</button>
          <button type="button" onClick={() => setView("preview")} className={view === "preview" ? "active" : ""}><Eye size={13} /> Aperçu</button>
          <button type="button" onClick={runCode}><Play size={13} /> Exécuter</button>
          <button type="button" onClick={() => void copyCode()} aria-label="Copier le code HTML"><Copy size={13} /> Copier</button>
          <button type="button" onClick={resetCode} aria-label="Réinitialiser le code"><RotateCcw size={13} /></button>
        </div>
      </header>
      {view === "code" ? (
        <textarea className="html-runner-editor" aria-label="Code HTML modifiable" spellCheck={false} value={code} onChange={event => setCode(event.target.value)} />
      ) : (
        <iframe
          className="html-runner-preview"
          title="Aperçu HTML isolé"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={makeDocument(previewCode)}
        />
      )}
      <footer className="html-runner-footer"><span>{status}</span><span>Scripts isolés · accès système et réseau bloqués</span></footer>
    </section>
  );
}
