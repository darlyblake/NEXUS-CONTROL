import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Cable, CheckCircle2, CircleHelp, Contact, Download, HardDrive, MessageSquare, RefreshCw, Smartphone, Usb, Wrench, FolderOpen, Send, FileCheck2, PhoneCall, Save, ShieldCheck } from "lucide-react";
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
  const [mtpUri, setMtpUri] = useState("");
  const [mtpListing, setMtpListing] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [remotePath, setRemotePath] = useState("");
  const [serialPort, setSerialPort] = useState("/dev/ttyUSB0");
  const [gammuOutput, setGammuOutput] = useState("");
  const [memory, setMemory] = useState("ME");
  const [firmwareFile, setFirmwareFile] = useState("");
  const [firmwareModel, setFirmwareModel] = useState("");
  const [connectedModel, setConnectedModel] = useState("");
  const [firmwareHash, setFirmwareHash] = useState("");
  const [maintenanceOutput, setMaintenanceOutput] = useState("");
  const [operationBusy, setOperationBusy] = useState(false);

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

  const runOperation = async (command: string, args: Record<string, string>, target: "mtp" | "gammu" | "maintenance") => {
    setOperationBusy(true);
    try {
      const result = await invoke<unknown>(command, args);
      const display = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      if (target === "mtp") setMtpListing(display);
      else if (target === "gammu") setGammuOutput(display);
      else setMaintenanceOutput(display);
      onNotice("Opération terminée.");
    } catch (cause) {
      const message = String(cause);
      if (target === "mtp") setMtpListing(message);
      else if (target === "gammu") setGammuOutput(message);
      else setMaintenanceOutput(message);
      onNotice("Opération impossible : " + message);
    } finally { setOperationBusy(false); }
  };

  const runFirmwareCheck = async () => {
    setOperationBusy(true);
    try {
      const result = await invoke<{valid:boolean;status:string;sha256:string}>("classic_validate_firmware", {
        file: firmwareFile, connectedModel, expectedModel: firmwareModel, expectedSha256: firmwareHash
      });
      setMaintenanceOutput(result.status + "\\nSHA-256 : " + result.sha256);
      onNotice(result.valid ? "Empreinte et modèle vérifiés. Aucun flashage effectué." : "Firmware refusé.");
    } catch (cause) {
      setMaintenanceOutput(String(cause));
      onNotice("Vérification firmware impossible.");
    } finally { setOperationBusy(false); }
  };

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

    <section className="panel classic-panel">
      <div className="panel-header"><div><h3>Transfert de fichiers MTP</h3><p>Parcours et copie via GVFS. Le téléphone doit être déverrouillé et autoriser le transfert.</p></div><HardDrive size={19}/></div>
      <div className="classic-form-grid">
        <label>URI du téléphone<input value={mtpUri} onChange={e=>setMtpUri(e.target.value)} placeholder="mtp://[usb:001,016]/"/></label>
        <button className="button button-secondary" disabled={operationBusy} onClick={() => void runOperation("classic_mtp_mounts",{},"mtp")}><Usb size={15}/> Voir les montages</button>
        <button className="button button-secondary" disabled={operationBusy || !mtpUri} onClick={() => void runOperation("classic_mtp_list",{uri:mtpUri},"mtp")}><FolderOpen size={15}/> Parcourir l'URI</button>
        <label>Chemin local<input value={localPath} onChange={e=>setLocalPath(e.target.value)} placeholder="/home/utilisateur/Images/photo.jpg"/></label>
        <label>URI distante du fichier ou dossier<input value={remotePath} onChange={e=>setRemotePath(e.target.value)} placeholder="mtp://.../Internal shared storage/"/></label>
        <div className="classic-actions">
          <button className="button button-secondary" disabled={operationBusy || !remotePath || !localPath} onClick={() => void runOperation("classic_mtp_copy_from",{uri:remotePath,destination:localPath},"mtp")}><Download size={15}/> Téléphone vers Ubuntu</button>
          <button className="button button-secondary" disabled={operationBusy || !localPath || !remotePath} onClick={() => void runOperation("classic_mtp_copy_to",{source:localPath,uri:remotePath},"mtp")}><Send size={15}/> Ubuntu vers téléphone</button>
        </div>
      </div>
      <pre className="classic-output">{mtpListing || "Les montages, fichiers et transferts apparaîtront ici."}</pre>
      <p className="classic-help">Ubuntu : sudo apt install gvfs-backends gvfs-fuse libmtp-runtime. Récupère l'URI MTP depuis les montages affichés ou ton gestionnaire de fichiers.</p>
    </section>
    <section className="panel classic-panel">
      <div className="panel-header"><div><h3>Contacts et SMS — Gammu</h3><p>Lecture via un port modem AT compatible. Une interface MTP seule ne donne pas accès aux contacts ni aux SMS.</p></div><Contact size={19}/></div>
      <div className="classic-form-grid">
        <label>Port série<input value={serialPort} onChange={e=>setSerialPort(e.target.value)} placeholder="/dev/ttyUSB0"/></label>
        <button className="button button-secondary" disabled={operationBusy || !serialPort} onClick={() => void runOperation("classic_gammu_identify",{device:serialPort},"gammu")}><PhoneCall size={15}/> Identifier</button>
        <label>Mémoire contacts<select value={memory} onChange={e=>setMemory(e.target.value)}><option value="ME">Téléphone (ME)</option><option value="SM">Carte SIM (SM)</option></select></label>
        <div className="classic-actions">
          <button className="button button-secondary" disabled={operationBusy || !serialPort} onClick={() => void runOperation("classic_gammu_read_contacts",{device:serialPort,memory},"gammu")}><Save size={15}/> Lire contacts</button>
          <button className="button button-secondary" disabled={operationBusy || !serialPort} onClick={() => void runOperation("classic_gammu_read_sms",{device:serialPort},"gammu")}><MessageSquare size={15}/> Lire SMS</button>
        </div>
      </div>
      <pre className="classic-output">{gammuOutput || "Les résultats Gammu apparaîtront ici."}</pre>
      <p className="classic-help">Ubuntu : sudo apt install gammu. Le téléphone doit exposer un modem AT et le compte utilisateur doit avoir accès au port série. Ces opérations sont en lecture seule.</p>
    </section>
    <section className="panel classic-panel">
      <div className="panel-header"><div><h3>Maintenance et validation firmware</h3><p>Vérifie le modèle et l'empreinte du paquet avant toute intervention constructeur.</p></div><ShieldCheck size={19}/></div>
      <div className="classic-form-grid">
        <label>Modèle exact détecté<input value={connectedModel} onChange={e=>setConnectedModel(e.target.value)} placeholder="Référence exacte de l'appareil"/></label>
        <label>Modèle annoncé par le firmware<input value={firmwareModel} onChange={e=>setFirmwareModel(e.target.value)} placeholder="Référence exacte du paquet"/></label>
        <label>Chemin du fichier firmware<input value={firmwareFile} onChange={e=>setFirmwareFile(e.target.value)} placeholder="/home/utilisateur/Téléchargements/firmware.bin"/></label>
        <label>SHA-256 officiel attendu<input value={firmwareHash} onChange={e=>setFirmwareHash(e.target.value)} placeholder="64 caractères hexadécimaux"/></label>
        <button className="button button-secondary" disabled={operationBusy || !firmwareFile || !connectedModel || !firmwareModel || !firmwareHash} onClick={() => void runFirmwareCheck()}><FileCheck2 size={15}/> Vérifier le firmware</button>
      </div>
      <pre className="classic-output">{maintenanceOutput || "Aucun contrôle effectué. Cette vérification ne flashe jamais le téléphone."}</pre>
      <div className="classic-notice"><ShieldCheck size={17}/><div><strong>Flashage non activé</strong><p>Le contrôle vérifie l'égalité exacte des modèles saisis et le SHA-256. Il ne prouve pas la signature constructeur. Aucun flashage générique n'est lancé : il faut un adaptateur validé pour chaque modèle/chipset et un firmware officiel.</p></div></div>
    </section>
  </div>;
}
