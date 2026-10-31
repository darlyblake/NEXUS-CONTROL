import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Cable, CheckCircle2, CircleHelp, Contact, Download, HardDrive, MessageSquare, RefreshCw, Smartphone, Usb, Wrench } from "lucide-react";
import "./classic-phones.css";

type Device = {
  id: string; vendorId: string; productId: string; manufacturer: string; product: string;
  bus: string; address: string; brand: string; likelyPhone: boolean; protocols: string[];
  supportsFiles: boolean; possibleContactsSms: boolean; maintenanceStatus: string; diagnostic: string;
};
type Tool = { id: string; label: string; installed: boolean; detail: string };

const brands = ["Toutes", "itel", "Nokia", "TECNO", "Samsung", "Maxcom", "Autre marque / non identifiée"];

export function ClassicPhones({ runtime, onNotice }: { runtime: boolean; onNotice: (message: string) => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [filter, setFilter] = useState("Toutes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const scan = useCallback(async () => {
    if (!runtime) { setError("La détection USB nécessite l'application de bureau NEXUS CONTROL."); return; }
    setBusy(true); setError("");
    try {
      const [found, available] = await Promise.all([
        invoke<Device[]>("scan_classic_phones"),
        invoke<Tool[]>("get_classic_phone_tools")
      ]);
      setDevices(found); setTools(available);
      onNotice(found.length ? found.length + " périphérique(s) USB détecté(s). Les fonctions sont affichées selon les interfaces réellement exposées." : "Aucun périphérique USB détecté. Vérifie le câble et reconnecte le téléphone.");
    } catch (cause) {
      setError(String(cause)); onNotice("Diagnostic USB impossible : " + String(cause));
    } finally { setBusy(false); }
  }, [runtime, onNotice]);

  useEffect(() => { void scan(); }, [scan]);

  const visible = devices.filter(device => filter === "Toutes" || device.brand.toLowerCase().includes(filter.toLowerCase()));

  return <div className="classic-phone-page">
    <div className="classic-hero">
      <div className="classic-hero-icon"><Smartphone size={25}/></div>
      <div className="classic-hero-copy">
        <span className="classic-kicker">CONNECTEUR USB LINUX</span>
        <h2>Diagnostic des téléphones classiques</h2>
        <p>itel, Nokia, TECNO, Samsung, Maxcom et autres marques. NEXUS identifie les interfaces disponibles avant d'activer une fonction.</p>
      </div>
      <button className="button button-primary" onClick={() => void scan()} disabled={busy || !runtime}>
        <RefreshCw size={15} className={busy ? "spin" : ""}/>{busy ? "Analyse…" : "Scanner USB"}
      </button>
    </div>

    {error && <div className="classic-error"><CircleHelp size={17}/>{error}</div>}

    <div className="classic-stats">
      <div className="classic-stat"><Usb size={19}/><span>Périphériques USB</span><strong>{devices.length}</strong></div>
      <div className="classic-stat"><Smartphone size={19}/><span>Téléphones probables</span><strong>{devices.filter(d => d.likelyPhone).length}</strong></div>
      <div className="classic-stat"><Wrench size={19}/><span>Outils disponibles</span><strong>{tools.filter(t => t.installed).length}/{tools.length}</strong></div>
    </div>

    <section className="panel classic-panel">
      <div className="panel-header">
        <div><h3>Appareils USB détectés</h3><p>Lecture seule des informations exposées par Linux ; aucun flashage ni déverrouillage n'est lancé.</p></div>
        <span className="count-pill">{visible.length} appareil(s)</span>
      </div>
      <div className="classic-filter">
        <label htmlFor="classic-brand-filter">Filtrer par marque</label>
        <select id="classic-brand-filter" value={filter} onChange={event => setFilter(event.target.value)}>
          {brands.map(brand => <option key={brand} value={brand}>{brand}</option>)}
        </select>
      </div>
      {visible.length === 0 ? <div className="classic-empty"><Smartphone size={27}/><strong>Aucun appareil dans cette liste</strong><p>Branche un téléphone avec un câble USB de données, puis clique sur Scanner USB.</p></div> :
        <div className="classic-device-list">{visible.map(device => <article className="classic-device" key={device.id + device.vendorId + device.productId}>
          <div className="classic-device-top">
            <div className="classic-device-icon"><Smartphone size={20}/></div>
            <div className="classic-device-name"><strong>{device.product}</strong><span>{device.manufacturer} · {device.brand}</span></div>
            <span className={device.likelyPhone ? "classic-tag classic-tag-phone" : "classic-tag"}>{device.likelyPhone ? "Téléphone probable" : "USB détecté"}</span>
          </div>
          <div className="classic-device-meta"><span>VID:PID <code>{device.vendorId}:{device.productId}</code></span><span>Bus {device.bus || "?"} · périphérique {device.address || "?"}</span></div>
          <p className="classic-diagnostic"><Activity size={15}/>{device.diagnostic}</p>
          <div className="classic-capabilities">
            <div><HardDrive size={16}/><span>Fichiers</span><strong>{device.supportsFiles ? "Interface détectée" : "Non exposée"}</strong></div>
            <div><Contact size={16}/><span>Contacts / SMS</span><strong>{device.possibleContactsSms ? "Interface de communication — à tester" : "Non détectée"}</strong></div>
            <div><Wrench size={16}/><span>Maintenance</span><strong>Firmware compatible requis</strong></div>
          </div>
          <div className="classic-protocols"><b>Protocoles :</b> {device.protocols.length ? device.protocols.join(" · ") : "Aucun protocole identifié"}</div>
        </article>)}</div>}
    </section>

    <section className="panel classic-panel">
      <div className="panel-header"><div><h3>Outils installés sur Ubuntu</h3><p>NEXUS détecte les outils disponibles sans installer ni exécuter de logiciel de flashage.</p></div><Cable size={19}/></div>
      <div className="classic-tool-list">{tools.map(tool => <div className="classic-tool" key={tool.id}>
        <div className={tool.installed ? "classic-tool-status ready" : "classic-tool-status"}>{tool.installed ? <CheckCircle2 size={17}/> : <CircleHelp size={17}/>}</div>
        <div><strong>{tool.label}</strong><span>{tool.detail}</span></div>
        <small>{tool.installed ? "Installé" : "Absent"}</small>
      </div>)}</div>
    </section>

    <div className="classic-notice"><MessageSquare size={17}/><div><strong>Contacts et SMS</strong><p>Ces données ne sont accessibles que si le téléphone expose un protocole documenté et autorise l'accès. Gammu ne fonctionne pas avec tous les téléphones à touches.</p></div></div>
    <div className="classic-notice"><Download size={17}/><div><strong>Maintenance / firmware</strong><p>Le flashage sera ajouté par adaptateur constructeur, avec vérification stricte du modèle, du firmware, de la signature et confirmation avant toute écriture. Aucun firmware générique ne sera proposé.</p></div></div>
  </div>;
}
