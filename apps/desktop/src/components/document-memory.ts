import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import * as mammoth from "mammoth/mammoth.browser";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

export async function extractOfficeDocument(file: File): Promise<string> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (file.size > 20 * 1024 * 1024) throw new Error(file.name + " dépasse la limite de 20 Mo.");
  if (extension === "pdf") {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    if (pdf.numPages > 250) throw new Error("Le PDF dépasse la limite de 250 pages.");
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const text = content.items.map(item => "str" in item ? item.str : "").join(" ");
      pages.push("[Page " + pageNo + "]\n" + text);
    }
    const result = pages.join("\n\n");
    if (!result.trim()) throw new Error("Aucun texte extractible. Le PDF est peut-être un scan : l'OCR n'est pas encore intégré.");
    if (result.length > 180_000) throw new Error("Le texte extrait dépasse 180 000 caractères. Divise le document.");
    return result;
  }
  if (extension === "docx") {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value.trim();
    if (!text) throw new Error("Aucun texte n'a été trouvé dans ce document DOCX.");
    if (text.length > 180_000) throw new Error("Le texte extrait dépasse 180 000 caractères. Divise le document.");
    return text;
  }
  throw new Error("Format non pris en charge. Utilise PDF ou DOCX.");
}
