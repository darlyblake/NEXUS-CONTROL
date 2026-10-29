import { Fragment, useState, type ReactNode } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

type Props = { content: string };

function safeUrl(value: string, image = false): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:" || (!image && url.protocol === "mailto:")) return url.href;
  } catch {
    if (value.startsWith("/") && !value.startsWith("//")) return value;
  }
  return null;
}

function inline(text: string): ReactNode[] {
  const pattern = /(\x60[^\x60]+\x60|\*\*.*?\*\*|~~.*?~~|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\))/g;
  const parts = text.split(pattern).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("\x60") && part.endsWith("\x60")) {
      return <code className="adaptive-inline-code" key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("~~") && part.endsWith("~~")) return <del key={index}>{part.slice(2, -2)}</del>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      const src = safeUrl(image[2], true);
      return src ? <img className="adaptive-image" key={index} src={src} alt={image[1]} loading="lazy" /> : <span key={index}>{image[1]}</span>;
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = safeUrl(link[2]);
      return href ? <a key={index} href={href} target="_blank" rel="noreferrer noopener">{link[1]} <ExternalLink size={12} aria-hidden="true" /></a> : <span key={index}>{link[1]}</span>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="adaptive-code">
      <div className="adaptive-code-head">
        <span>{language || "Code"}</span>
        <button type="button" onClick={() => void copyCode()} aria-label="Copier le code">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copié" : "Copier"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export function AdaptiveMessage({ content }: Props) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(/^\s*\x60{3,}\s*([\w#+.-]*)/);
    if (fence) {
      const language = fence[1] || "";
      i++;
      const code: string[] = [];
      while (i < lines.length && !/^\s*\x60{3,}\s*$/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      const source = code.join("\n");
      if (language === "nexus-card") {
        try {
          const card = JSON.parse(source) as { title?: string; description?: string; status?: string; fields?: Array<{ label: string; value: string }> };
          blocks.push(
            <section className="adaptive-info-card" key={key++}>
              {card.status && <span className="adaptive-card-status">{card.status}</span>}
              {card.title && <h3>{card.title}</h3>}
              {card.description && <p>{card.description}</p>}
              {Array.isArray(card.fields) && card.fields.length > 0 && <dl>{card.fields.map((field, j) => <div key={j}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
            </section>
          );
        } catch {
          blocks.push(<CodeBlock key={key++} code={source} language={language} />);
        }
      } else if (language === "nexus-chart") {
        try {
          const chart = JSON.parse(source) as { title?: string; unit?: string; labels?: string[]; values?: number[] };
          const entries = (chart.labels || []).map((label, j) => ({ label, value: Number(chart.values?.[j] ?? 0) })).filter(item => Number.isFinite(item.value));
          const max = Math.max(1, ...entries.map(item => item.value));
          blocks.push(
            <section className="adaptive-chart" key={key++}>
              {chart.title && <h3>{chart.title}</h3>}
              {entries.map((entry, j) => <div className="adaptive-chart-row" key={j}>
                <div className="adaptive-chart-label"><span>{entry.label}</span><strong>{entry.value.toLocaleString("fr-FR")}{chart.unit ? " " + chart.unit : ""}</strong></div>
                <div className="adaptive-chart-track"><span style={{ width: Math.max(0, Math.min(100, entry.value / max * 100)) + "%" }} /></div>
              </div>)}
            </section>
          );
        } catch {
          blocks.push(<CodeBlock key={key++} code={source} language={language} />);
        }
      } else {
        blocks.push(<CodeBlock key={key++} code={source} language={language} />);
      }
      continue;
    }

    if (i + 1 < lines.length && line.includes("|") && isTableDivider(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitTableRow(lines[i++]));
      blocks.push(
        <div className="adaptive-table-wrap" key={key++}>
          <table className="adaptive-table">
            <thead><tr>{headers.map((cell, j) => <th key={j}>{inline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r}>{headers.map((_, c) => <td key={c}>{inline(row[c] || "")}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      const depth = heading[1].length;
      const text = heading[2];
      const className = "adaptive-heading adaptive-heading-" + depth;
      blocks.push(<div className={className} key={key++}>{inline(text)}</div>);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push(<blockquote className="adaptive-quote" key={key++}>{quote.map((text, j) => <p key={j}>{inline(text)}</p>)}</blockquote>);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push(<ul className="adaptive-list" key={key++}>{items.map((text, j) => <li key={j}>{inline(text)}</li>)}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      blocks.push(<ol className="adaptive-list" key={key++}>{items.map((text, j) => <li key={j}>{inline(text)}</li>)}</ol>);
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1+\s*$/.test(line)) {
      blocks.push(<hr className="adaptive-divider" key={key++} />);
      i++;
      continue;
    }

    const paragraph = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^\s*\x60{3,}/.test(lines[i]) && !/^\s{0,3}#{1,6}\s/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !(i + 1 < lines.length && lines[i].includes("|") && isTableDivider(lines[i + 1]))) {
      paragraph.push(lines[i++].trim());
    }
    blocks.push(<p className="adaptive-paragraph" key={key++}>{paragraph.map((text, j) => <Fragment key={j}>{j > 0 ? " " : ""}{inline(text)}</Fragment>)}</p>);
  }

  return <div className="adaptive-message-body">{blocks}</div>;
}
