import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ScreenSharePanel } from "./components/ScreenSharePanel";
import { LocalAIChat } from "./components/LocalAIChat";
import { LocalAISettings } from "./components/LocalAIAgent";
import {
  Activity, AlertCircle, Apple, ArrowDownToLine, ArrowUpRight, Bot, Check, FileDown, FileUp,
  ChevronDown, CircleHelp, Clock3, Command, Cpu, FileText, Folder, Gauge,
  HardDrive, LayoutDashboard, Link2, LockKeyhole, Monitor, MonitorSmartphone,
  MoreHorizontal, Network, Plus, Radar, RefreshCw, Search, Settings2, ShieldCheck,
  Smartphone, Terminal, Tv, Wifi, WifiOff, Workflow, Wrench, Zap, Camera, MapPin, MessageSquare, Volume2, ShieldAlert
} from "lucide-react";

type Page = "overview" | "assistant" | "devices" | "files" | "remote" | "network" | "integrations" | "automations" | "activity" | "security" | "protection" | "settings";
type NetworkDevice = { ip: string; hostname: string; mac: string; kind: string; manufacturer: string; model: string; deviceType: string; osGuess: string; evidence: string[]; connection: string; adbStatus: string };
type LocalTool = { id: string; label: string; installed: boolean; detail: string };
type AuditCheck = { id: string; label: string; status: string; detail: string };
type AndroidDevice = { id: string; state: string; model: string };
type UpdateInfo = { currentVersion: string; version: string; downloadUrl: string; checksumUrl: string; assetName: string; notes: string };

const nav: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "assistant", label: "Assistant IA", icon: Bot },
  { id: "devices", label: "Mes appareils", icon: MonitorSmartphone },
  { id: "files", label: "Transfert de fichiers", icon: Folder },
  { id: "remote", label: "Accès distant", icon: Link2 },
  { id: "network", label: "Analyse réseau", icon: Radar },
  { id: "integrations", label: "Intégrations", icon: Network },
  { id: "automations", label: "Automatisations", icon: Workflow },
  { id: "activity", label: "Journal d'activité", icon: Activity },
];
const secondaryNav: { id: Page; label: string; icon: typeof ShieldCheck }[] = [
  { id: "security", label: "Sécurité", icon: ShieldCheck },
  { id: "protection", label: "Protection antivol", icon: ShieldAlert },
  { id: "settings", label: "Paramètres", icon: Settings2 },
];

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  overview: { title: "Vue d'ensemble", subtitle: "L'état de ton centre de contrôle, en un seul endroit." },
  assistant: { title: "Assistant IA", subtitle: "Chat local et agent IA avec accès contrôlé aux fichiers de cet ordinateur." },
  devices: { title: "Mes appareils", subtitle: "Appareils enregistrés et appareils détectés localement." },
  files: { title: "Transfert de fichiers", subtitle: "Échanges de fichiers entre appareils compatibles ; ADB Android est le premier connecteur disponible." },
  remote: { title: "Accès distant", subtitle: "Connecte un PC, un appareil Android ou un appareil Apple selon les fonctions autorisées par son système." },
  network: { title: "Analyse réseau", subtitle: "Découvre les appareils qui répondent sur le même réseau local." },
  integrations: { title: "Intégrations", subtitle: "Connecteurs logiciels utilisés par NEXUS CONTROL." },
  automations: { title: "Automatisations", subtitle: "Prépare des tâches répétables, avec contrôle et journalisation." },
  activity: { title: "Journal d'activité", subtitle: "Historique des vérifications et des opérations locales." },
  security: { title: "Sécurité", subtitle: "Les accès distants restent désactivés tant qu'ils ne sont pas configurés." },
  protection: { title: "Protection antivol", subtitle: "Commandes de protection Android, état des capacités et préparation de l'administration de l'appareil." },
  settings: { title: "Paramètres", subtitle: "Configuration locale de l'application et de ses connecteurs." },
};

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function App() {
  const [page, setPage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [tools, setTools] = useState<LocalTool[]>([]);
  const [android, setAndroid] = useState<AndroidDevice[]>([]);
  const [networkDevices, setNetworkDevices] = useState<NetworkDevice[]>([]);
  const [networkTypeFilter, setNetworkTypeFilter] = useState("all");
  const [networkConnectionFilter, setNetworkConnectionFilter] = useState("all");
  const [networkSearch, setNetworkSearch] = useState("");
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [networkScanning, setNetworkScanning] = useState(false);
  const [connectingIp, setConnectingIp] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [installingIntegration, setInstallingIntegration] = useState<string | null>(null);
  const [installingAndroid, setInstallingAndroid] = useState(false);
  const [fileLocalPath, setFileLocalPath] = useState("");
  const [filePcDestination, setFilePcDestination] = useState("");
  const [fileAndroidPath, setFileAndroidPath] = useState("/sdcard/Download/");
  const [fileAndroidSource, setFileAndroidSource] = useState("/sdcard/Download/document.pdf");
  const [wifiReceiverUrl, setWifiReceiverUrl] = useState("");
  const [wifiReceiverToken, setWifiReceiverToken] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [runtime, setRuntime] = useState(isDesktopRuntime());
  const [notice, setNotice] = useState("Bienvenue dans NEXUS CONTROL. Les connecteurs ne sont pas encore configurés.");
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [remoteServerUrl, setRemoteServerUrl] = useState(() => { try { return localStorage.getItem("nexus.remoteServerUrl") || ""; } catch { return ""; } });
  const [openingRemoteConsole, setOpeningRemoteConsole] = useState(false);
  const [remoteRelayUrl, setRemoteRelayUrl] = useState(() => { try { return localStorage.getItem("nexus.remoteRelayUrl") || ""; } catch { return ""; } });
  const [remotePairCode, setRemotePairCode] = useState("");
  const [remoteDesktopToken, setRemoteDesktopToken] = useState("");
  const [remoteRelayStatus, setRemoteRelayStatus] = useState("Non connecté");
  const [remoteCommandResult, setRemoteCommandResult] = useState("Aucune commande envoyée.");
  const [remotePeerRole, setRemotePeerRole] = useState<"android" | "windows" | null>(null);
  const [remotePowerShellScript, setRemotePowerShellScript] = useState("Get-ComputerInfo | Select-Object CsName, WindowsProductName, OsVersion");
  const [remoteLastLocation, setRemoteLastLocation] = useState<{ latitude: number; longitude: number; accuracyMeters?: number; locationTime?: number; provider?: string } | null>(null);
  const [remoteMessage, setRemoteMessage] = useState("Téléphone perdu. Merci de contacter son propriétaire.");
  const [remoteDeviceId] = useState(() => "pc-" + (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)));
  const remoteSocketRef = useRef<WebSocket | null>(null);
  const [auditChecks, setAuditChecks] = useState<AuditCheck[]>([]);
  const [runningAudit, setRunningAudit] = useState(false);

  const createRemotePair = useCallback(async () => {
    const base = remoteRelayUrl.trim().replace(/\/$/, "");
    let parsed: URL;
    try { parsed = new URL(base); } catch { setNotice("Adresse du relais invalide."); return; }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      setNotice("Le relais distant doit utiliser HTTPS/WSS. HTTP n'est permis que pour un test local.");
      return;
    }
    setOpeningRemoteConsole(true);
    setRemoteRelayStatus("Création de l'association…");
    setRemotePairCode("");
    remoteSocketRef.current?.close();
    try {
      const response = await fetch(base + "/api/pair", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId: remoteDeviceId }) });
      const data = await response.json() as { pairCode?: string; pairId?: string; desktopToken?: string; error?: string; message?: string };
      if (!response.ok || !data.pairCode || !data.pairId || !data.desktopToken) throw new Error(data.message || data.error || "Le relais a refusé la demande.");
      setRemotePairCode(data.pairCode);
      setRemoteDesktopToken(data.desktopToken);
      const socketUrl = new URL(base);
      socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
      socketUrl.pathname = "/ws"; socketUrl.search = ""; socketUrl.hash = "";
      const socket = new WebSocket(socketUrl.toString());
      remoteSocketRef.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "auth", deviceId: remoteDeviceId, token: data.desktopToken }));
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; role?: string; connected?: boolean; action?: string; ok?: boolean; detail?: string; output?: string; latitude?: number; longitude?: number; accuracyMeters?: number; locationTime?: number; provider?: string };
          if (message.type === "authenticated") setRemoteRelayStatus("Relais authentifié — en attente de l’appareil cible");
          if (message.type === "peer_status") {
            if (message.connected && (message.role === "windows" || message.role === "android")) setRemotePeerRole(message.role);
            if (!message.connected && (message.role === "windows" || message.role === "android")) setRemotePeerRole(null);
            setRemoteRelayStatus(message.connected ? (message.role === "windows" ? "Agent Windows connecté" : message.role === "android" ? "Agent Android connecté" : "Contrôleur connecté") : "En attente de l’appareil cible");
          }
          if (message.type === "command_result") {
            setRemoteCommandResult((message.action || "Commande") + " : " + (message.ok ? "réussie" : "échec") + (message.detail ? " — " + message.detail : "") + (message.output ? "\n" + message.output : ""));
            if (message.action === "location_request" && message.ok && typeof message.latitude === "number" && typeof message.longitude === "number") {
              setRemoteLastLocation({ latitude: message.latitude, longitude: message.longitude, accuracyMeters: message.accuracyMeters, locationTime: message.locationTime, provider: message.provider });
            }
          }
        } catch { /* ignore les messages de statut non JSON */ }
      };
      socket.onerror = () => setRemoteRelayStatus("Erreur de connexion au relais");
      socket.onclose = () => setRemoteRelayStatus("Déconnecté du relais");
      setNotice("Code d’association créé. Saisis-le dans l’agent de l’appareil cible (Windows ou Android) avant son expiration.");
    } catch (error) {
      setRemoteRelayStatus("Association indisponible");
      setNotice("Impossible de joindre le relais : " + String(error));
    } finally { setOpeningRemoteConsole(false); }
  }, [remoteRelayUrl, remoteDeviceId]);

  const sendAntitheftCommand = useCallback((action: "location_request" | "ring_start" | "ring_stop" | "show_message") => {
    const socket = remoteSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setRemoteCommandResult("Commande non envoyée : connecte le relais et le téléphone.");
      return;
    }
    const commandId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    const command: { type: string; action: string; commandId: string; timestamp: number; message?: string } = { type: "command", action, commandId, timestamp: Date.now() };
    if (action === "show_message") command.message = remoteMessage.trim().slice(0, 240);
    if (action === "show_message" && !command.message) { setRemoteCommandResult("Saisis un message avant de l'envoyer."); return; }
    socket.send(JSON.stringify(command));
    setRemoteCommandResult("Commande envoyée : " + action + ". En attente de l'accusé de réception…");
  }, [remoteMessage]);


  const sendWindowsCommand = useCallback((action: "windows_status" | "windows_list_processes" | "windows_run_powershell") => {
    const socket = remoteSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || remotePeerRole !== "windows") {
      setRemoteCommandResult("Commande non envoyée : associe et connecte un agent Windows.");
      return;
    }
    const commandId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    const command: { type: string; action: string; commandId: string; timestamp: number; script?: string } = {
      type: "command", action, commandId, timestamp: Date.now()
    };
    if (action === "windows_run_powershell") {
      const script = remotePowerShellScript.trim();
      if (!script || script.length > 8000) {
        setRemoteCommandResult("Le script doit contenir entre 1 et 8000 caractères.");
        return;
      }
      if (!window.confirm("Exécuter ce script PowerShell sur l’ordinateur Windows associé ? S’il est activé sur la cible, il s’exécutera avec les droits du service Windows, potentiellement SYSTEM.")) return;
      command.script = script;
    }
    socket.send(JSON.stringify(command));
    setRemoteCommandResult("Commande envoyée : " + action + ". En attente du résultat de l’agent…");
  }, [remotePeerRole, remotePowerShellScript]);

  useEffect(() => () => { remoteSocketRef.current?.close(); }, []);

  const refreshLocal = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setRuntime(false);
      setNotice("Aperçu navigateur : la détection des outils nécessite l'application de bureau Tauri.");
      return;
    }
    setChecking(true);
    try {
      const [toolResult, deviceResult] = await Promise.all([
        invoke<LocalTool[]>("get_local_tools"),
        invoke<AndroidDevice[]>("scan_android_devices"),
      ]);
      setTools(toolResult);
      setAndroid(deviceResult);
      setLastCheck(new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }));
      setNotice("Vérification locale terminée.");
    } catch (error) {
      setNotice("La vérification locale a échoué : " + String(error));
    } finally {
      setChecking(false);
    }
  }, []);

  const scanNetwork = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setNotice("L'analyse du réseau nécessite l'application de bureau NEXUS CONTROL.");
      return;
    }
    setNetworkScanning(true);
    setNotice("Analyse du réseau local en cours…");
    try {
      const devices = await invoke<NetworkDevice[]>("scan_network_devices");
      setNetworkDevices(devices);
      setNotice(`Analyse terminée : ${devices.length} appareil(s) détecté(s) sur le réseau local.`);
    } catch (error) {
      setNotice("Impossible d'analyser le réseau : " + String(error));
    } finally {
      setNetworkScanning(false);
    }
  }, []);

  const connectNetworkAndroid = useCallback(async (ip: string) => {
    if (!isDesktopRuntime()) {
      setNotice("La connexion Android nécessite l'application de bureau NEXUS CONTROL.");
      return;
    }
    if (!tools.some(tool => tool.id === "adb" && tool.installed)) {
      setNotice("Connexion non lancée : ADB n'est pas installé ou détecté. Installe Android platform-tools, puis clique sur « Actualiser les outils » avant de réessayer.");
      return;
    }
    setConnectingIp(ip);
    setNotice("Recherche d'un service ADB autorisé sur " + ip + "…");
    try {
      const message = await invoke<string>("connect_network_android", { ip });
      setNotice(message);
      await refreshLocal();
    } catch (error) {
      setNotice(String(error));
    } finally {
      setConnectingIp(null);
    }
  }, [refreshLocal, tools]);

  const recoverBrokenScreen = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setNotice("La récupération nécessite l'application de bureau NEXUS CONTROL.");
      return;
    }
    setChecking(true);
    setNotice("Diagnostic de récupération Android en cours…");
    try {
      const devices = await invoke<AndroidDevice[]>("scan_android_devices");
      setAndroid(devices);
      const ready = devices.find((device) => device.state === "device");
      if (ready && tools.some((tool) => tool.id === "scrcpy" && tool.installed)) {
        await invoke("launch_scrcpy", { serial: ready.id });
        setNotice("Un appareil déjà autorisé (" + ready.model + " — " + ready.id + ") est disponible : scrcpy a été lancé. Si l'écran est cassé, tu peux tenter de le contrôler depuis l'ordinateur.");
        return;
      }
      if (devices.some((device) => device.state === "unauthorized")) {
        setNotice("Téléphone détecté, mais ADB indique « unauthorized ». NEXUS CONTROL ne peut pas supprimer cette autorisation. Pour ton téléphone : essaie une souris USB OTG ou un écran externe compatible pour confirmer la demande RSA ; sinon utilise un ordinateur déjà autorisé ou la récupération officielle du fabricant. Après autorisation, relance le diagnostic.");
        return;
      }
      if (devices.some((device) => device.state === "offline")) {
        setNotice("Le téléphone est détecté mais ADB le signale hors ligne. Essaie un câble USB de données, un autre port, puis débranche/rebranche le téléphone. Si l'autorisation RSA apparaît, confirme-la sur l'appareil. Aucun contournement d'autorisation n'est possible depuis le scanner réseau.");
        return;
      }
      setNotice("Aucun appareil Android déjà autorisé n'est prêt. Branche le téléphone avec un câble USB de données. Si l'écran est inutilisable, essaie une souris USB OTG ou un écran externe compatible pour déverrouiller le téléphone et autoriser le débogage. Si le débogage USB n'avait jamais été activé et cet ordinateur jamais autorisé, Nmap/arp-scan ne peuvent pas remplacer cette étape.");
    } catch (error) {
      setNotice("Diagnostic impossible : " + String(error));
    } finally {
      setChecking(false);
    }
  }, [tools]);

  const installIntegration = useCallback(async (integrationId: string) => {
    if (!isDesktopRuntime()) {
      setNotice("L'installation automatique nécessite l'application de bureau NEXUS CONTROL, pas l'aperçu navigateur.");
      return;
    }
    setInstallingIntegration(integrationId);
    setNotice("Préparation du script d'installation pour ton système…");
    try {
      const message = await invoke<string>("install_integration", { integrationId });
      setNotice(message);
    } catch (error) {
      setNotice("Impossible de démarrer l'installation : " + String(error));
    } finally {
      setInstallingIntegration(null);
    }
  }, []);

  const buildAndInstallAndroid = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setNotice("La compilation et l'installation nécessitent l'application de bureau NEXUS CONTROL.");
      return;
    }
    if (installingAndroid) return;
    setInstallingAndroid(true);
    setNotice("Vérification du téléphone Android, compilation de l'APK puis installation…");
    try {
      const message = await invoke<string>("build_and_install_android");
      await refreshLocal();
      setNotice(message);
    } catch (error) {
      await refreshLocal();
      setNotice("Compilation / installation impossible : " + String(error));
    } finally {
      setInstallingAndroid(false);
    }
  }, [installingAndroid, refreshLocal]);

  const prepareNetworkAgent = useCallback(async (device: NetworkDevice) => {
    if (device.deviceType === "phone" || /android/i.test(device.osGuess)) {
      setNotice("Préparation de l'agent Android : connecte ce téléphone en USB, active le débogage USB et accepte la demande RSA sur le téléphone. L'installation ne sera lancée qu'après cette autorisation.");
      await buildAndInstallAndroid();
      return;
    }
    if (/windows/i.test(device.osGuess)) {
      setNotice("PC Windows probable détecté. La découverte réseau ne peut pas associer l’agent automatiquement. Dans Accès distant, vérifie l’URL du relais, crée un nouveau code puis saisis-le sur le PC Windows avec l’installateur de l’agent.");
      setPage("remote");
      return;
    }
    if (device.deviceType === "computer") {
      setNotice("Ordinateur détecté, mais son système n'est pas confirmé. Ouvre Accès distant pour choisir l'agent adapté ; vérifie Windows/Linux sur le PC cible avant l'installation.");
      setPage("remote");
      return;
    }
    setNotice("Le système de cet appareil n'est pas identifié avec assez de certitude pour choisir un agent. Consulte les indices et confirme son système avant l'installation.");
  }, [buildAndInstallAndroid]);

  const runSecurityAudit = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setNotice("L'audit local nécessite l'application de bureau NEXUS CONTROL.");
      return;
    }
    setRunningAudit(true);
    setNotice("Vérification locale des outils et du pare-feu…");
    try {
      const checks = await invoke<AuditCheck[]>("get_security_audit");
      setAuditChecks(checks);
      const available = checks.filter((check) => check.status === "Disponible" || check.status === "Actif").length;
      setNotice(`Audit local terminé : ${available}/${checks.length} contrôles disposent d'un outil ou d'une protection détectée. Aucun hôte externe n'a été scanné.`);
    } catch (error) {
      setNotice("L'audit local a échoué : " + String(error));
    } finally {
      setRunningAudit(false);
    }
  }, []);

  useEffect(() => {
    void refreshLocal();
    if (isDesktopRuntime()) {
      void invoke<UpdateInfo | null>("check_app_update")
        .then((update) => {
          if (update) {
            setUpdateAvailable(update);
            setNotice(`La version ${update.version} de NEXUS CONTROL est disponible. Tu peux l'installer maintenant.`);
          }
        })
        .catch(() => {
          // Une vérification de mise à jour qui échoue ne bloque pas l'application.
        });
    }
  }, [refreshLocal]);

  const installAppUpdate = useCallback(async () => {
    if (!updateAvailable || installingUpdate) return;
    const details = updateAvailable.notes ? `\\n\\nNotes : ${updateAvailable.notes}` : "";
    const accepted = window.confirm(
      `NEXUS CONTROL ${updateAvailable.version} est disponible (version actuelle : ${updateAvailable.currentVersion}).\\n\\nL'installation demandera ton mot de passe Ubuntu pour remplacer le paquet .deb.${details}\\n\\nInstaller maintenant ?`
    );
    if (!accepted) return;
    setInstallingUpdate(true);
    setNotice("Téléchargement et vérification de la mise à jour en cours…");
    try {
      const message = await invoke<string>("install_app_update");
      setUpdateAvailable(null);
      setNotice(message);
    } catch (error) {
      setNotice("La mise à jour n'a pas pu être installée : " + String(error));
    } finally {
      setInstallingUpdate(false);
    }
  }, [updateAvailable, installingUpdate]);

  const connectedAndroid = android.filter((d) => d.state === "device").length;
  const filteredAndroid = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return android;
    return android.filter((device) => [device.id, device.model, device.state].some((v) => v.toLowerCase().includes(normalized)));
  }, [android, query]);

  const navigate = (id: Page) => { setPage(id); if (id === "network") void scanNetwork(); };
  const title = pageTitles[page];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Command size={23} strokeWidth={2.3} /></div>
          <div><div className="brand-name">NEXUS<span>CONTROL</span></div><div className="brand-caption">PERSONAL DEVICE HUB</div></div>
        </div>

        <div className="workspace-switch">
          <div className="workspace-icon"><Monitor size={18} /></div>
          <div className="workspace-copy"><strong>Poste principal</strong><span>Environnement local</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>

        <div className="nav-label">ESPACE DE TRAVAIL</div>
        <nav className="nav-list">
          {nav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}>
              <Icon size={18} /><span>{item.label}</span>{item.id === "devices" && android.length > 0 && <span className="nav-count">{android.length}</span>}
            </button>;
          })}
        </nav>

        <div className="nav-label settings-label">ADMINISTRATION</div>
        <nav className="nav-list">
          {secondaryNav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>

        <div className="sidebar-spacer" />
        <div className="connection-card">
          <div className="connection-heading"><span className={`status-dot ${runtime ? "dot-green" : "dot-amber"}`} />{runtime ? "Application de bureau" : "Mode aperçu"}</div>
          <p>{runtime ? "Les commandes locales sont disponibles." : "Ouvre l'application Tauri pour détecter les outils."}</p>
          <button className="text-button" onClick={() => navigate("integrations")}>Configurer les intégrations <ArrowUpRight size={14} /></button>
        </div>
        <div className="profile-row">
          <div className="avatar">NC</div><div className="profile-copy"><strong>Administrateur local</strong><span>Session de développement</span></div><MoreHorizontal size={18} className="muted-icon"/>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{title.title}</strong></div>
          <div className="topbar-actions">
            <div className="environment-pill"><span className="status-dot dot-green" />LOCAL</div>
            <button className="icon-button" aria-label="Sécurité" onClick={() => navigate("security")}><ShieldCheck size={18}/></button>
            <button className="icon-button" aria-label="Paramètres" onClick={() => navigate("settings")}><Settings2 size={18}/></button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div><div className="eyebrow">CENTRE DE CONTRÔLE <span>/</span> {page.toUpperCase()}</div><h1>{title.title}</h1><p>{title.subtitle}</p></div>
            <div className="heading-actions">
              <button className="button button-secondary" onClick={() => void refreshLocal()} disabled={checking}><RefreshCw size={16} className={checking ? "spin" : ""}/>{checking ? "Vérification…" : "Actualiser"}</button>
              {page === "devices" && <><button className="button button-secondary" disabled={installingAndroid} onClick={() => void refreshLocal()}><RefreshCw size={15} className={checking ? "spin" : ""}/> Détecter le téléphone</button><button className="button button-primary" disabled={installingAndroid || !runtime} onClick={() => void buildAndInstallAndroid()}>{installingAndroid ? <><RefreshCw size={15} className="spin"/> Compilation / installation…</> : <><ArrowDownToLine size={16}/> Compiler et installer sur Android</>}</button></>}
            </div>
          </div>

          {notice && <div className="notice-line"><span className="notice-indicator"><AlertCircle size={15}/></span><span>{notice}</span>{updateAvailable && <button className="button button-primary button-small" disabled={installingUpdate} onClick={() => void installAppUpdate()}>{installingUpdate ? "Installation…" : "Installer la mise à jour"}</button>}<button aria-label="Fermer le message" onClick={() => setNotice("")}>×</button></div>}

          {page === "assistant" && <LocalAIChat runtime={runtime} /> }

          {page === "overview" && <section className="page-body">
            <div className="welcome-panel">
              <div className="welcome-copy"><div className="welcome-chip"><Zap size={13}/> VOTRE ESPACE PERSONNEL</div><h2>Tout ton environnement.<br/><span>Un seul centre de contrôle.</span></h2><p>Connecte tes appareils, vérifie leur disponibilité et centralise tes outils de gestion à distance.</p><button className="button button-light" onClick={() => navigate("integrations")}>Configurer les intégrations <ArrowUpRight size={16}/></button></div>
              <div className="welcome-graphic" aria-hidden="true"><div className="orbit orbit-one"></div><div className="orbit orbit-two"></div><div className="orbit-core"><Command size={36}/></div><div className="orbit-node node-a"><Monitor size={17}/></div><div className="orbit-node node-b"><Smartphone size={17}/></div><div className="orbit-node node-c"><Tv size={17}/></div><div className="orbit-node node-d"><Network size={17}/></div></div>
            </div>

            <div className="section-heading"><div><h2>État du système</h2><p>Informations observées sur ce poste, pas de données simulées.</p></div><span className="subtle-label">{lastCheck ? `Dernière vérification · ${lastCheck}` : "En attente de vérification"}</span></div>
            <div className="stats-grid">
              <StatCard icon={<MonitorSmartphone size={19}/>} label="Appareils Android détectés" value={String(android.length)} foot={connectedAndroid ? `${connectedAndroid} autorisé(s) et disponible(s)` : "Aucun appareil prêt"} tone="blue"/>
              <StatCard icon={<Network size={19}/>} label="Outils disponibles" value={String(tools.filter((t) => t.installed).length)} foot={`sur ${tools.length || 3} contrôles locaux`} tone="violet"/>
              <StatCard icon={<Workflow size={19}/>} label="Automatisations actives" value="0" foot="Aucune règle configurée" tone="orange"/>
              <StatCard icon={<ShieldCheck size={19}/>} label="Accès distant" value="Désactivé" foot="Sécurité locale par défaut" tone="green"/>
            </div>

            <div className="dashboard-columns">
              <div className="panel">
                <div className="panel-header"><div><h3>Intégrations principales</h3><p>État des outils sur ce poste</p></div><button className="small-link" onClick={() => navigate("integrations")}>Tout voir <ArrowUpRight size={14}/></button></div>
                <div className="integration-list">
                  <IntegrationRow icon={<Monitor size={19}/>} name="MeshCentral" description="Gestion des ordinateurs" status={tools.find(t => t.id === "meshcentral")?.installed ? "Outil détecté" : "À configurer"} good={!!tools.find(t => t.id === "meshcentral")?.installed}/>
                  <IntegrationRow icon={<Smartphone size={19}/>} name="scrcpy / ADB" description="Contrôle des appareils Android" status={tools.some(t => t.id === "adb" && t.installed) && tools.some(t => t.id === "scrcpy" && t.installed) ? "Outils détectés" : "À configurer"} good={tools.some(t => t.id === "adb" && t.installed) && tools.some(t => t.id === "scrcpy" && t.installed)}/>
                  <IntegrationRow icon={<Network size={19}/>} name="WireGuard" description="Réseau privé distant" status="Non configuré" good={false}/>
                </div>
              </div>
              <div className="panel">
                <div className="panel-header"><div><h3>Accès rapide</h3><p>Actions disponibles dans cette version</p></div></div>
                <div className="quick-actions">
                  <QuickAction icon={<Smartphone size={18}/>} title="Détecter Android" desc="Scanner via ADB" onClick={() => void refreshLocal()}/>
                  <QuickAction icon={<Radar size={18}/>} title="Analyser le réseau" desc="Rechercher les appareils du Wi-Fi local" onClick={() => navigate("network")}/>
                  <QuickAction icon={<Network size={18}/>} title="Configurer un connecteur" desc="Voir les intégrations" onClick={() => navigate("integrations")}/>
                  <QuickAction icon={<ShieldCheck size={18}/>} title="Vérifier la sécurité" desc="Consulter les règles locales" onClick={() => navigate("security")}/>
                  <QuickAction icon={<FileText size={18}/>} title="Feuille de route" desc="Consulter les prochaines étapes" onClick={() => navigate("activity")}/>
                </div>
              </div>
            </div>
            <div className="footer-note"><LockKeyhole size={14}/> Les commandes distantes restent indisponibles tant que leurs connecteurs ne sont pas configurés et testés.</div>
          </section>}

          {page === "devices" && <section className="page-body">
            {remotePeerRole === "windows" && <div className="panel device-panel"><div className="panel-header"><div><h3>Agent Windows connecté</h3><p>Un agent distant est authentifié via le relais NEXUS CONTROL.</p></div><span className="security-state secure-text">Connecté</span></div><div className="security-row"><div className="security-row-icon secure"><Monitor size={17}/></div><div className="security-row-copy"><strong>PC Windows associé</strong><span>Commandes disponibles dans Accès distant. La détection réseau locale n’est pas nécessaire pour cette connexion.</span></div><button className="button button-primary" onClick={() => navigate("remote")}>Ouvrir Accès distant</button></div></div>}
            <div className="filter-bar"><div className="search-box"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un appareil Android…" /></div><div className="heading-actions"><button className="button button-secondary" onClick={() => void recoverBrokenScreen()} disabled={checking}><Smartphone size={15}/>{checking ? "Diagnostic…" : "Écran cassé ? Récupérer l'accès"}</button><button className="button button-secondary" onClick={() => void refreshLocal()} disabled={checking}><RefreshCw size={15} className={checking ? "spin" : ""}/> Scanner via ADB</button></div></div>
            <div className="panel device-panel"><div className="panel-header"><div><h3>Appareils Android détectés</h3><p>Les appareils sont listés uniquement si ADB les retourne réellement.</p></div><span className="count-pill">{filteredAndroid.length} trouvé(s)</span></div>
              {filteredAndroid.length === 0 ? <EmptyState icon={<Smartphone size={24}/>} title="Aucun appareil Android détecté" description="Branche un téléphone avec un câble USB de données, active le débogage USB et autorise cet ordinateur. Puis lance un nouveau scan." action="Voir les instructions" onAction={() => { setNotice("Dans un terminal : adb devices. Si le téléphone affiche unauthorized, confirme l'autorisation RSA sur l'écran du téléphone."); }}/> :
              <div className="table-wrap"><table><thead><tr><th>APPAREIL</th><th>IDENTIFIANT</th><th>ÉTAT ADB</th><th>CONTRÔLE</th></tr></thead><tbody>{filteredAndroid.map((device) => <tr key={device.id}><td><div className="device-cell"><div className="device-icon"><Smartphone size={18}/></div><div><strong>{device.model || "Appareil Android"}</strong><span>Android / ADB</span></div></div></td><td className="mono">{device.id}</td><td><span className={`state-pill ${device.state === "device" ? "state-ready" : "state-warn"}`}><span className="status-dot"/>{device.state}</span></td><td><button className="button button-secondary button-small" disabled={!runtime || device.state !== "device" || !tools.some(t => t.id === "scrcpy" && t.installed)} onClick={() => void invoke("launch_scrcpy", { serial: device.id }).then(() => setNotice("scrcpy a été lancé pour " + device.id + ".")).catch((error) => setNotice("Impossible de lancer scrcpy : " + String(error)))}>Écran distant</button></td></tr>)}</tbody></table></div>}
            </div>
            <div className="info-banner"><CircleHelp size={17}/><div><strong>Les autres appareils apparaîtront ici après intégration.</strong><p>Windows/Linux via MeshCentral, Android TV via le connecteur compatible, et Apple selon les capacités de gestion autorisées.</p></div></div>
          </section>}


          {page === "files" && <section className="page-body">
            <div className="network-hero">
              <div className="network-hero-icon"><Folder size={25}/></div>
              <div className="network-hero-copy"><h2>Fichiers Android par USB / ADB</h2><p>Transfert réel entre le PC et un téléphone Android autorisé. Le téléphone doit apparaître comme « device » dans Mes appareils. Cette première version utilise ADB et ne fonctionne pas encore à travers Internet.</p></div>
              <button className="button button-secondary" onClick={() => void refreshLocal()} disabled={checking}><RefreshCw size={15} className={checking ? "spin" : ""}/> Actualiser</button>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Appareil cible</h3><p>Sélectionne le téléphone qui recevra ou fournira le fichier.</p></div><span className="count-pill">{android.filter(d => d.state === "device").length} autorisé(s)</span></div>
              {android.filter(d => d.state === "device").length === 0 ? <EmptyState icon={<Smartphone size={24}/>} title="Aucun téléphone prêt" description="Branche le téléphone avec un câble USB de données, active le débogage USB et accepte la demande d'autorisation Android. Puis actualise." action="Détecter les appareils" onAction={() => void refreshLocal()}/> :
              <div className="network-filters"><label>Appareil Android<select id="file-android-device" defaultValue={android.find(d => d.state === "device")?.id}>{android.filter(d => d.state === "device").map(d => <option key={d.id} value={d.id}>{d.model} — {d.id}</option>)}</select></label></div>}
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Envoyer un fichier du PC vers Android</h3><p>Saisis le chemin absolu du fichier sur Ubuntu et le dossier de destination sur le téléphone.</p></div><FileUp size={19}/></div>
              <label className="remote-field-label" htmlFor="nexus-local-file">Fichier sur le PC (chemin absolu)</label>
              <input id="nexus-local-file" className="remote-server-input" placeholder="/home/utilisateur/Téléchargements/document.pdf" value={fileLocalPath} onChange={e => setFileLocalPath(e.target.value)}/>
              <label className="remote-field-label" htmlFor="nexus-android-destination">Destination Android</label>
              <input id="nexus-android-destination" className="remote-server-input" placeholder="/sdcard/Download/" value={fileAndroidPath} onChange={e => setFileAndroidPath(e.target.value)}/>
              <div className="heading-actions remote-actions"><button className="button button-primary" disabled={fileBusy || !fileLocalPath.trim() || !android.some(d => d.state === "device")} onClick={() => {
                const select = document.getElementById("file-android-device") as HTMLSelectElement | null;
                const serial = select?.value || android.find(d => d.state === "device")?.id;
                if (!serial) { setNotice("Aucun appareil Android autorisé."); return; }
                setFileBusy(true);
                void invoke<string>("adb_push_file", { serial, localPath: fileLocalPath.trim(), remotePath: fileAndroidPath.trim() || "/sdcard/Download/" })
                  .then(setNotice).catch(error => setNotice("Envoi échoué : " + String(error))).finally(() => setFileBusy(false));
              }}><FileUp size={16}/>{fileBusy ? "Transfert en cours…" : "Envoyer vers Android"}</button></div>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Envoyer vers Android par Wi-Fi</h3><p>Pour envoyer sans câble, ouvre la page Réception dans l'application Android, démarre le récepteur et recopie l'adresse et le jeton affichés.</p></div><Wifi size={19}/></div>
              <label className="remote-field-label" htmlFor="nexus-wifi-receiver-url">Adresse locale Android</label>
              <input id="nexus-wifi-receiver-url" className="remote-server-input" placeholder="http://192.168.1.20:8765" value={wifiReceiverUrl} onChange={e => setWifiReceiverUrl(e.target.value)}/>
              <label className="remote-field-label" htmlFor="nexus-wifi-receiver-token">Jeton de réception</label>
              <input id="nexus-wifi-receiver-token" className="remote-server-input" placeholder="Jeton affiché sur Android" value={wifiReceiverToken} onChange={e => setWifiReceiverToken(e.target.value)}/>
              <div className="heading-actions remote-actions"><button className="button button-primary" disabled={fileBusy || !fileLocalPath.trim() || !wifiReceiverUrl.trim() || !wifiReceiverToken.trim()} onClick={() => {
                setFileBusy(true);
                void invoke<string>("send_file_to_local_receiver", { localPath: fileLocalPath.trim(), receiverUrl: wifiReceiverUrl.trim(), token: wifiReceiverToken.trim() })
                  .then(setNotice).catch(error => setNotice("Envoi Wi-Fi échoué : " + String(error))).finally(() => setFileBusy(false));
              }}><Wifi size={16}/>{fileBusy ? "Transfert en cours…" : "Envoyer par Wi-Fi"}</button></div>
              <div className="info-banner"><ShieldCheck size={17}/><div><strong>Réseau local uniquement</strong><p>Les deux appareils doivent être sur le même Wi-Fi. Le jeton protège le transfert, mais ce protocole local n'utilise pas HTTPS. N'active pas la réception sur un réseau public et arrête-la après usage.</p></div></div>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Récupérer un fichier depuis Android</h3><p>Indique un chemin de fichier existant sur Android et le chemin de destination sur le PC.</p></div><FileDown size={19}/></div>
              <label className="remote-field-label" htmlFor="nexus-android-source">Fichier Android (chemin absolu)</label>
              <input id="nexus-android-source" className="remote-server-input" placeholder="/sdcard/Download/document.pdf" value={fileAndroidSource} onChange={e => setFileAndroidSource(e.target.value)}/>
              <label className="remote-field-label" htmlFor="nexus-local-destination">Enregistrer sur le PC (chemin absolu)</label>
              <input id="nexus-local-destination" className="remote-server-input" placeholder="/home/utilisateur/Téléchargements/document.pdf" value={filePcDestination} onChange={e => setFilePcDestination(e.target.value)}/>
              <div className="heading-actions remote-actions"><button className="button button-secondary" disabled={fileBusy || !filePcDestination.trim() || !fileAndroidSource.trim() || !android.some(d => d.state === "device")} onClick={() => {
                const select = document.getElementById("file-android-device") as HTMLSelectElement | null;
                const serial = select?.value || android.find(d => d.state === "device")?.id;
                if (!serial) { setNotice("Aucun appareil Android autorisé."); return; }
                setFileBusy(true);
                void invoke<string>("adb_pull_file", { serial, remotePath: fileAndroidSource.trim(), localPath: filePcDestination.trim() })
                  .then(setNotice).catch(error => setNotice("Récupération échouée : " + String(error))).finally(() => setFileBusy(false));
              }}><FileDown size={16}/>{fileBusy ? "Transfert en cours…" : "Récupérer sur le PC"}</button></div>
              <div className="info-banner"><CircleHelp size={17}/><div><strong>Limite de cette première étape</strong><p>Le transfert fonctionne seulement avec ADB autorisé via USB ou ADB réseau déjà configuré. L'accès à distance par Internet nécessitera un agent/serveur sécurisé ; ne publie jamais le port ADB sur Internet.</p></div></div>
            </div>
          </section>}

          {page === "remote" && <section className="page-body">
            <div className="network-hero">
              <div className="network-hero-icon"><Link2 size={25}/></div>
              <div className="network-hero-copy"><h2>Connecter tous tes appareils</h2><p>NEXUS CONTROL vise les connexions PC ↔ PC, PC ↔ Android, PC ↔ iPhone/iPad et les connexions mobiles compatibles. Le contrôleur et l’appareil distant peuvent être de types différents ; les fonctions disponibles dépendent du système et des autorisations. Configure ici le serveur sécurisé pour les appareils compatibles. Aucun port entrant n’est ouvert sur cet ordinateur.</p></div>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Relier un appareil par Internet</h3><p>Association temporaire entre ce PC et un agent NEXUS CONTROL Windows ou Android, même si les appareils ne partagent pas le Wi-Fi.</p></div><span className="count-pill">MVP</span></div>
              <label className="remote-field-label" htmlFor="nexus-relay-url">URL HTTPS du relais NEXUS</label>
              <input id="nexus-relay-url" className="remote-server-input" type="url" placeholder="https://relais.ton-domaine.tld" value={remoteRelayUrl} onChange={event => { const value = event.target.value; setRemoteRelayUrl(value); try { localStorage.setItem("nexus.remoteRelayUrl", value.trim()); } catch { /* stockage facultatif */ } }} />
              <div className="heading-actions remote-actions"><button className="button button-primary" disabled={!remoteRelayUrl.trim() || openingRemoteConsole} onClick={() => void createRemotePair()}><Link2 size={16}/>{openingRemoteConsole ? "Connexion…" : "Créer un code d'association"}</button></div>
              {remotePairCode && <div className="security-row"><div className="security-row-icon secure"><LockKeyhole size={16}/></div><div className="security-row-copy"><strong>Code temporaire : {remotePairCode}</strong><span>À saisir sur l’appareil cible dans les 5 minutes. Ne le partage pas publiquement.</span></div><button className="button button-secondary" onClick={() => { void navigator.clipboard?.writeText(remotePairCode); setNotice("Code copié si le presse-papiers est disponible."); }}>Copier</button></div>}
              <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>État du relais</strong><span>{remoteRelayStatus}</span></div></div>
              {remotePeerRole === "windows" && <ScreenSharePanel socket={remoteSocketRef.current} connected={remoteRelayStatus.includes("connecté") || remoteRelayStatus.includes("authentifié")} onNotice={setNotice} />}
              {remotePeerRole === "windows" && <div className="panel device-panel">
                <div className="panel-header"><div><h3>Contrôle Windows</h3><p>Commandes envoyées uniquement à l’agent Windows authentifié dans cette association.</p></div><Terminal size={20}/></div>
                <div className="heading-actions remote-actions">
                  <button className="button button-secondary" onClick={() => sendWindowsCommand("windows_status")}><Monitor size={16}/>État du PC</button>
                  <button className="button button-secondary" onClick={() => sendWindowsCommand("windows_list_processes")}><Activity size={16}/>Lister les processus</button>
                </div>
                <label className="remote-field-label" htmlFor="windows-powershell-script">Script PowerShell (limite 8000 caractères)</label>
                <textarea id="windows-powershell-script" className="remote-server-input" rows={6} value={remotePowerShellScript} onChange={event => setRemotePowerShellScript(event.target.value)} spellCheck={false}/>
                <div className="heading-actions remote-actions"><button className="button button-primary" onClick={() => sendWindowsCommand("windows_run_powershell")}><Terminal size={16}/>Exécuter sur Windows</button></div>
                <p className="remote-description">PowerShell distant doit avoir été activé explicitement pendant l’installation sur Windows. Il s’exécute avec l’identité du service et peut être privilégié. Ne l’utilise que sur un appareil que tu administres.</p>
                <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>Résultat</strong><span style={{ whiteSpace: "pre-wrap" }}>{remoteCommandResult}</span></div></div>
              </div>}
              {remoteDesktopToken && <div className="heading-actions remote-actions"><button className="button button-secondary" onClick={() => {
                const base = remoteRelayUrl.trim().replace(/\/$/, "");
                void fetch(base + "/api/revoke", { method: "POST", headers: { "authorization": "Bearer " + remoteDesktopToken } })
                  .then(async response => { if (!response.ok) throw new Error("Le relais n'a pas confirmé la révocation."); setNotice("Association révoquée côté serveur."); setRemoteDesktopToken(""); setRemotePairCode(""); setRemoteRelayStatus("Association révoquée"); remoteSocketRef.current?.close(); remoteSocketRef.current = null; })
                  .catch(error => setNotice("Révocation impossible : " + String(error)));
              }}><LockKeyhole size={16}/>Révoquer cette association</button></div>}
              <div className="info-banner"><ShieldCheck size={17}/><div><strong>Fonction en cours d'intégration</strong><p>Ce panneau crée un code et ouvre la connexion au relais. Le relais doit d'abord être déployé en HTTPS/WSS. Le canal transporte des messages, mais le transfert de fichiers et le contrôle d'écran ne sont pas encore branchés à ce canal.</p></div></div>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Serveur distant</h3><p>Adresse publique de ta console, par exemple https://controle.ton-domaine.tld</p></div><span className="count-pill">HTTPS requis</span></div>
              <label className="remote-field-label" htmlFor="remote-server-url">URL publique MeshCentral</label>
              <input id="remote-server-url" className="remote-server-input" type="url" placeholder="https://controle.exemple.com" value={remoteServerUrl} onChange={event => { setRemoteServerUrl(event.target.value); try { localStorage.setItem("nexus.remoteServerUrl", event.target.value.trim()); } catch { /* stockage facultatif */ } }} />
              <div className="heading-actions remote-actions">
                <button className="button button-primary" disabled={!remoteServerUrl.trim() || openingRemoteConsole} onClick={() => {
                  if (!isDesktopRuntime()) {
                    try { const parsed = new URL(remoteServerUrl); if (parsed.protocol !== "https:") { setNotice("Utilise une adresse HTTPS pour protéger la connexion."); return; } window.open(parsed.toString(), "_blank", "noopener,noreferrer"); }
                    catch { setNotice("Adresse du serveur invalide."); }
                    return;
                  }
                  setOpeningRemoteConsole(true);
                  void invoke<string>("open_remote_console", { url: remoteServerUrl.trim() }).then(message => setNotice(message)).catch(error => setNotice(String(error))).finally(() => setOpeningRemoteConsole(false));
                }}><ArrowUpRight size={16}/>{openingRemoteConsole ? "Ouverture…" : "Ouvrir la console distante"}</button>
                <button className="button button-secondary" onClick={() => { setRemoteServerUrl(""); try { localStorage.removeItem("nexus.remoteServerUrl"); } catch { /* stockage facultatif */ } }}>Effacer l'adresse</button>
              </div>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Tester une solution multiplateforme</h3><p>RustDesk peut servir à tester certaines connexions entre PC et Android. Pour iPhone/iPad, le partage d’écran et le contrôle sont limités par iOS/iPadOS ; ne pas supposer qu’un contrôle complet est possible.</p></div><Smartphone size={20}/></div>
              <p className="remote-description">RustDesk propose un client Android et un client de bureau. Installe-les uniquement depuis les sources officielles, associe les appareils avec un identifiant et un mot de passe, puis accorde manuellement les autorisations Android nécessaires. Les fonctions disponibles dépendent du téléphone et de sa version d'Android.</p>
              <div className="heading-actions remote-actions"><button className="button button-primary" onClick={() => { setOpeningRemoteConsole(true); void invoke<string>("open_remote_console", { url: "https://rustdesk.com/" }).then(message => setNotice("Site officiel RustDesk ouvert. Installe les clients PC et Android depuis ce site, puis configure une session autorisée.")).catch(error => setNotice(String(error))).finally(() => setOpeningRemoteConsole(false)); }} disabled={openingRemoteConsole}><ArrowUpRight size={16}/>{openingRemoteConsole ? "Ouverture…" : "Ouvrir le site officiel RustDesk"}</button></div>
            </div>
            <div className="info-banner"><ShieldCheck size={17}/><div><strong>Avant de contrôler un appareil</strong><p>1. Déployer MeshCentral sur un serveur accessible en HTTPS. 2. Installer l'agent officiel sur l'ordinateur distant et approuver son rattachement. 3. Se connecter à la console et limiter les droits aux opérateurs autorisés. 4. Utiliser les fonctions de partage/invitation du serveur lorsqu'un accès temporaire est nécessaire.</p></div></div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>État de l'intégration</h3><p>NEXUS CONTROL ne déclare pas une session active sans vérification du serveur.</p></div></div>
              <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>Serveur public</strong><span>À configurer et à vérifier</span></div><span className="security-state pending-text">En attente</span></div>
              <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>Contrôle distant et transfert de fichiers</strong><span>Selon les permissions et les capacités du serveur/agent.</span></div><span className="security-state pending-text">Non vérifiés</span></div>
              <div className="security-row"><div className="security-row-icon secure"><Check size={16}/></div><div className="security-row-copy"><strong>Autorisation explicite</strong><span>Ne partage pas une invitation avec une personne non autorisée. Révoque les accès qui ne sont plus nécessaires.</span></div><span className="security-state secure-text">Obligatoire</span></div>
            </div>
            <div className="info-banner"><CircleHelp size={17}/><div><strong>Important pour Android</strong><p>Cette console ne donne pas automatiquement le contrôle d'un téléphone Android. Le contrôle Android nécessite un connecteur compatible, une configuration prise en charge par le téléphone et une autorisation explicite sur celui-ci.</p></div></div>
          </section>}

          {page === "network" && <section className="page-body">
            <div className="network-hero">
              <div className="network-hero-icon"><Radar size={25}/></div>
              <div className="network-hero-copy"><h2>Appareils du réseau local</h2><p>Recherche les hôtes joignables sur l'interface réseau active, puis utilise les noms, fabricants et indices disponibles pour estimer leur type. Les actions proposent l'agent adapté ; l'installation distante nécessite toujours une confirmation sur l'appareil cible.</p></div>
              <button className="button button-primary" onClick={() => void scanNetwork()} disabled={networkScanning}><Radar size={16} className={networkScanning ? "spin" : ""}/>{networkScanning ? "Analyse en cours…" : "Lancer l'analyse"}</button>
            </div>
            <div className="network-summary">
              <div><span className="network-summary-label">Appareils détectés</span><strong>{networkDevices.length}</strong></div>
              <div><span className="network-summary-label">Méthodes</span><strong>Nmap · ARP · Ping</strong></div>
              <div><span className="network-summary-label">Identification</span><strong>Indices vérifiés uniquement</strong></div>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Résultats du scan</h3><p>Les noms, fabricants et modèles sont séparés des hypothèses de type.</p></div><span className="count-pill">{networkDevices.length} appareil(s)</span></div>
              <div className="network-filters">
                <label>Type d'appareil<select value={networkTypeFilter} onChange={e => setNetworkTypeFilter(e.target.value)}><option value="all">Tous les appareils</option><option value="phone">Téléphones / tablettes</option><option value="computer">Ordinateurs</option><option value="tv">Téléviseurs / boîtiers</option><option value="network">Routeurs / équipements réseau</option><option value="unknown">Non identifié</option></select></label>
                <label>Connexion<select value={networkConnectionFilter} onChange={e => setNetworkConnectionFilter(e.target.value)}><option value="all">Toutes les connexions</option><option value="network">Wi-Fi / Ethernet</option><option value="adb">USB / ADB</option></select></label>
                <label className="network-search">Rechercher<input value={networkSearch} onChange={e => setNetworkSearch(e.target.value)} placeholder="Nom, fabricant, IP ou MAC…"/></label>
              </div>
              {(() => {
                const networkItems = networkDevices.slice();
                const adbItems: NetworkDevice[] = android.map(device => ({
                  ip: device.id.includes(":") ? device.id.split(":")[0] : "—",
                  hostname: device.model && device.model !== "Android" ? device.model : device.id,
                  mac: "",
                  kind: "Appareil Android détecté par ADB",
                  manufacturer: "Non identifié",
                  model: device.model && device.model !== "Android" ? device.model : "Modèle non communiqué par ADB",
                  deviceType: "phone",
                  osGuess: "Android (confirmé par ADB)",
                  evidence: ["Appareil retourné par ADB", "État ADB : " + device.state],
                  connection: device.id.includes(":") ? "Wi-Fi / ADB" : "USB / ADB",
                  adbStatus: device.state
                }));
                const allItems = [...networkItems, ...adbItems.filter(item => !networkItems.some(net => net.ip === item.ip && item.ip !== "—"))];
                const filtered = allItems.filter(device => {
                  const type = device.deviceType || "unknown";
                  const connection = device.connection.includes("ADB") ? "adb" : "network";
                  const search = networkSearch.trim().toLowerCase();
                  return (networkTypeFilter === "all" || type === networkTypeFilter)
                    && (networkConnectionFilter === "all" || connection === networkConnectionFilter)
                    && (!search || [device.hostname, device.manufacturer, device.model, device.ip, device.mac, device.kind].some(value => value.toLowerCase().includes(search)));
                });
                if (networkScanning && allItems.length === 0) return <div className="network-empty"><Radar size={27} className="spin"/><strong>Recherche des appareils sur le réseau…</strong><span>Cette opération peut prendre quelques secondes.</span></div>;
                if (!filtered.length) return <EmptyState icon={<Wifi size={24}/>} title="Aucun appareil correspondant" description={allItems.length ? "Modifie les filtres ou le texte de recherche." : "Vérifie que les appareils sont sur le même réseau. Certains appareils restent invisibles aux méthodes de découverte."} action="Réessayer l'analyse" onAction={() => void scanNetwork()}/>;
                return <div className="network-device-grid">{filtered.map((device) => <article className="network-device-card" key={device.ip}>
                  <div className="network-device-top"><div className="network-device-icon">{device.deviceType === "phone" ? <Smartphone size={20}/> : device.deviceType === "tv" ? <Tv size={20}/> : device.deviceType === "computer" ? <Monitor size={20}/> : <MonitorSmartphone size={20}/>}</div><span className="state-pill state-ready"><span className="status-dot"/>{device.connection.includes("ADB") ? device.adbStatus : "En ligne"}</span></div>
                  <h3>{device.hostname || (device.manufacturer !== "Non identifié" ? device.manufacturer + " — appareil" : "Appareil non identifié")}</h3><p className="network-device-kind">{device.kind}</p>
                  <div className="network-info-row"><span>Type</span><strong>{device.deviceType === "phone" ? "Téléphone / tablette probable" : device.deviceType === "computer" ? "Ordinateur probable" : device.deviceType === "tv" ? "Téléviseur / boîtier probable" : device.deviceType === "network" ? "Équipement réseau probable" : "Non identifié"}</strong></div>
                  <div className="network-info-row"><span>Fabricant</span><strong>{device.manufacturer || "Non identifié"}</strong></div>
                  <div className="network-info-row"><span>Modèle</span><strong>{device.model || "Inconnu — non communiqué par le réseau"}</strong></div>
                  <div className="network-info-row"><span>Adresse IP</span><strong className="mono">{device.ip}</strong></div>
                  <div className="network-info-row"><span>Adresse MAC</span><strong className="mono">{device.mac || "Non disponible"}</strong></div>
                  <div className="network-info-row"><span>Système</span><strong>{device.osGuess || "Non déterminé"}</strong></div>
                  <div className="network-info-row"><span>Connexion</span><strong>{device.connection || "Réseau local"}</strong></div>
                  <button className="button button-secondary full-button" onClick={() => setExpandedDevice(expandedDevice === device.ip ? null : device.ip)}><CircleHelp size={14}/>{expandedDevice === device.ip ? "Masquer les indices" : "Voir les détails et les indices"}</button>
                  {expandedDevice === device.ip && <div className="network-evidence"><strong>Indices utilisés</strong><ul>{(device.evidence?.length ? device.evidence : ["Aucun indice complémentaire disponible"]).map((item, index) => <li key={index}>{item}</li>)}</ul><p>Le type est une estimation. Le modèle exact reste inconnu tant qu'une source fiable ne le fournit pas.</p></div>}
                  {!device.connection.includes("ADB") && device.deviceType === "phone" && <button className="button button-primary full-button" disabled={installingAndroid} onClick={() => void prepareNetworkAgent(device)}>{installingAndroid ? <><RefreshCw size={14} className="spin"/> Préparation…</> : <><ArrowDownToLine size={14}/> Préparer l'agent Android</>}</button>}
                  {!device.connection.includes("ADB") && device.deviceType === "phone" && <button className="button button-secondary full-button" disabled={!!connectingIp} onClick={() => void connectNetworkAndroid(device.ip)}>{connectingIp === device.ip ? <><RefreshCw size={14} className="spin"/> Connexion…</> : <><Wifi size={14}/> Tester ADB sans fil autorisé</>}</button>}
                  {!device.connection.includes("ADB") && (device.deviceType === "computer" || /windows/i.test(device.osGuess)) && <button className="button button-primary full-button" onClick={() => void prepareNetworkAgent(device)}><ArrowDownToLine size={14}/> { /windows/i.test(device.osGuess) ? "Préparer l'agent Windows" : "Choisir l'agent du PC" }</button>}
                  {!device.connection.includes("ADB") && device.deviceType !== "phone" && device.deviceType !== "computer" && <button className="button button-secondary full-button" onClick={() => void prepareNetworkAgent(device)}><CircleHelp size={14}/> Identifier le système avant installation</button>}
                </article>)}</div>;
              })()}
            </div>
            <div className="info-banner"><CircleHelp size={17}/><div><strong>À savoir sur Android</strong><p>Le scan est automatique, mais Android n'autorise pas le contrôle à distance simplement parce qu'il est sur le même Wi-Fi. La connexion se fera si le débogage sans fil est actif et si ADB a déjà été autorisé/appairé. Si ce n'est pas le cas, l'application expliquera ce qui manque au lieu de contourner la sécurité du téléphone.</p></div></div>
          </section>}

          {page === "integrations" && <section className="page-body">
            <div className="integration-grid">
              <ConnectorCard icon={<Monitor size={23}/>} title="MeshCentral" category="Ordinateurs Windows / Linux" description="Installe le serveur local depuis un script adapté à Windows ou Linux, puis démarre sa console de configuration." state={tools.find(t => t.id === "meshcentral")?.installed ? "Installé localement" : "Installation requise"} tone={tools.find(t => t.id === "meshcentral")?.installed ? "good" : "neutral"} actionLabel={installingIntegration === "meshcentral" ? "Préparation…" : "Installer / configurer"} action={() => void installIntegration("meshcentral")}/>
              <ConnectorCard icon={<Smartphone size={23}/>} title="NEXUS Agent Android" category="Compiler et installer" description="Compile l’APK local, l’installe ou le met à jour sur un téléphone connecté et autorisé en USB, puis tente de l’ouvrir." state={android.some(d => d.state === "device") ? "Téléphone prêt" : "Téléphone requis"} tone={android.some(d => d.state === "device") ? "good" : "neutral"} action={() => void buildAndInstallAndroid()} actionLabel={installingAndroid ? "Compilation / installation…" : "Compiler et installer"}/>
              <ConnectorCard icon={<Radar size={23}/>} title="Nmap" category="Découverte réseau" description="Recherche les hôtes du sous-réseau local sans scanner les ports. Le bouton ouvre l'analyse réseau existante." state={tools.find(t => t.id === "nmap")?.installed ? "Outil détecté" : "Non installé"} tone={tools.find(t => t.id === "nmap")?.installed ? "good" : "neutral"} action={() => navigate("network")} actionLabel="Ouvrir l'analyse"/>
              <ConnectorCard icon={<Wifi size={23}/>} title="arp-scan" category="Découverte ARP locale" description="Complète la découverte des appareils sur le réseau local lorsque l'outil et ses permissions sont disponibles." state={tools.find(t => t.id === "arp-scan")?.installed ? "Outil détecté" : "Non installé"} tone={tools.find(t => t.id === "arp-scan")?.installed ? "good" : "neutral"} action={() => navigate("network")} actionLabel="Ouvrir l'analyse"/>
              <ConnectorCard icon={<Activity size={23}/>} title="Wireshark / TShark" category="Diagnostic du trafic" description="Le diagnostic de trafic sera activé après définition d'un périmètre et des permissions de capture. Vérifie d'abord la présence de TShark." state={tools.find(t => t.id === "tshark")?.installed ? "Outil détecté" : "Audit disponible"} tone="neutral" action={() => navigate("security")} actionLabel="Vérifier la présence"/>
                            <ConnectorCard icon={<Network size={23}/>} title="WireGuard" category="Accès distant privé" description="À activer uniquement après validation des contrôles locaux, des clés individuelles et du pare-feu." state="Non configuré" tone="neutral" action={() => setNotice("WireGuard est planifié pour une phase ultérieure. Aucun port distant n'est ouvert par NEXUS CONTROL.")}/>
              <ConnectorCard icon={<Tv size={23}/>} title="Android TV" category="Téléviseurs et boîtiers" description="Les fonctions disponibles dépendront du modèle, des paramètres de débogage et des API du fabricant." state="À développer" tone="neutral" action={() => setNotice("Le connecteur Android TV sera évalué après le premier prototype Android.")}/>
              <ConnectorCard icon={<Bot size={23}/>} title="Home Assistant" category="Objets connectés" description="Connexion future via l'API Home Assistant et un jeton à permissions limitées." state="À développer" tone="neutral" action={() => setNotice("Prévu : intégration via l'API Home Assistant. Aucun jeton n'est encore demandé ou stocké.")}/>
              <ConnectorCard icon={<Apple size={23}/>} title="Apple / MDM" category="iPhone et iPad" description="Gestion limitée aux fonctions officielles iOS/iPadOS et aux politiques MDM autorisées." state="Capacités limitées" tone="warn" action={() => setNotice("iOS/iPadOS ne permet pas un contrôle intégral comparable à un ordinateur. Les fonctions seront documentées précisément.")}/>
            </div>
          </section>}

          {page === "automations" && <section className="page-body"><div className="empty-page"><div className="empty-illustration"><Workflow size={30}/></div><h2>Les automatisations arrivent ensuite</h2><p>Le moteur sera ajouté après l'intégration sécurisée des connecteurs. Les tâches seront explicites, limitées en permissions et journalisées.</p><div className="roadmap-list"><div><Check size={16}/> Définir les appareils et leurs capacités</div><div><Check size={16}/> Mettre en place les permissions et l'historique</div><div><Clock3 size={16}/> Ajouter les déclencheurs et planifications</div></div><button className="button button-primary" onClick={() => navigate("security")}>Consulter la sécurité <ArrowUpRight size={15}/></button></div></section>}

          {page === "activity" && <section className="page-body"><div className="panel"><div className="panel-header"><div><h3>Journal de cette session</h3><p>Événements visibles de l'interface.</p></div><span className="count-pill">{lastCheck ? "Vérification effectuée" : "En attente"}</span></div><div className="activity-row"><div className="activity-icon"><Activity size={17}/></div><div className="activity-copy"><strong>Interface NEXUS CONTROL initialisée</strong><span>Les commandes distantes ne sont pas activées par défaut.</span></div><span className="activity-time">Session actuelle</span></div>{lastCheck && <div className="activity-row"><div className="activity-icon"><RefreshCw size={17}/></div><div className="activity-copy"><strong>Vérification des outils locaux</strong><span>ADB, scrcpy, Node.js et présence de MeshCentral.</span></div><span className="activity-time">{lastCheck}</span></div>}</div><div className="info-banner"><FileText size={17}/><div><strong>Ce journal est provisoire.</strong><p>La persistance et l'audit des actions seront ajoutés dans le service local, avant l'activation du contrôle à distance.</p></div></div></section>}

          {page === "security" && <section className="page-body">
            <div className="security-hero"><div className="security-shield"><ShieldCheck size={28}/></div><div><span className="security-kicker">AUDIT LOCAL</span><h2>Vérifier les outils et les protections de ce poste.</h2><p>Contrôles en lecture seule : présence des outils, versions quand disponibles et état du pare-feu local. Aucun scan de ports ni test sur une cible distante n'est lancé ici.</p></div><button className="button button-primary" onClick={() => void runSecurityAudit()} disabled={runningAudit}><ShieldCheck size={15} className={runningAudit ? "spin" : ""}/>{runningAudit ? "Audit en cours…" : "Lancer l'audit local"}</button></div>
            <div className="panel security-panel"><div className="panel-header"><div><h3>Résultats de l'audit</h3><p>Les résultats proviennent du système local et ne sont pas simulés.</p></div><span className="count-pill">{auditChecks.length ? `${auditChecks.length} contrôles` : "Pas encore exécuté"}</span></div>
              {auditChecks.length === 0 ? <EmptyState icon={<ShieldCheck size={24}/>} title="Aucun audit exécuté" description="Clique sur « Lancer l'audit local » pour vérifier Nmap, arp-scan, Netdiscover, Wireshark/TShark, WireGuard et le pare-feu UFW lorsqu'il est disponible." action="Lancer l'audit" onAction={() => void runSecurityAudit()}/> :
              auditChecks.map((check) => <div className="security-row" key={check.id}><div className={`security-row-icon ${check.status === "Disponible" || check.status === "Actif" ? "secure" : "pending"}`}>{check.status === "Disponible" || check.status === "Actif" ? <Check size={16}/> : <Clock3 size={16}/>}</div><div className="security-row-copy"><strong>{check.label}</strong><span>{check.detail}</span></div><span className={`security-state ${check.status === "Disponible" || check.status === "Actif" ? "secure-text" : "pending-text"}`}>{check.status}</span></div>)}
            </div>
            <div className="panel security-panel"><div className="panel-header"><div><h3>Règles avant le contrôle distant</h3><p>Ces contrôles de sécurité restent nécessaires avant toute connexion inter-réseaux.</p></div></div><SecurityRow title="Autorisation de l'appareil distant" detail="Le propriétaire doit accepter explicitement l'accès." state="Obligatoire" good={true}/><SecurityRow title="Tunnel chiffré ou serveur HTTPS" detail="Utiliser WireGuard ou un serveur distant configuré en HTTPS." state="À configurer" good={false}/><SecurityRow title="Journal d'audit persistant" detail="La journalisation persistante des sessions distantes reste à développer." state="À développer" good={false}/></div>
          </section>}

          {page === "protection" && <section className="page-body">
            <div className="security-hero"><div className="security-shield"><ShieldAlert size={28}/></div><div><span className="security-kicker">PROTECTION ANDROID</span><h2>Préparer les fonctions antivol de l’appareil.</h2><p>Première intégration disponible si NEXUS Agent reste ouvert et connecté au relais. Les limites de chaque commande sont indiquées ci-dessous.</p></div></div>
            <div className="stats-grid">
              <StatCard icon={<Smartphone size={19}/>} label="Android via ADB" value={String(connectedAndroid)} foot={connectedAndroid ? "Appareil local autorisé" : "Aucun appareil autorisé détecté"} tone="blue"/>
              <StatCard icon={<MapPin size={19}/>} label="Localisation GPS" value="Prototype actif" foot="Dernière position connue ; permission requise" tone="violet"/>
              <StatCard icon={<Volume2 size={19}/>} label="Sonnerie à distance" value="Prototype actif" foot="Agent connecté requis" tone="orange"/>
              <StatCard icon={<ShieldCheck size={19}/>} label="Mode administré" value="Non vérifié" foot="Device Owner non détecté par cette interface" tone="green"/>
            </div>
            <div className="panel security-panel">
              <div className="panel-header"><div><h3>Commandes à distance</h3><p>Fonctionnent uniquement si le relais et NEXUS Agent sont connectés. La demande GPS utilise la dernière position connue et peut demander une permission Android.</p></div><Link2 size={19}/></div>
              <div className="heading-actions remote-actions">
                <button className="button button-primary" onClick={() => sendAntitheftCommand("location_request")}><MapPin size={16}/>Demander la position</button>
                <button className="button button-secondary" onClick={() => sendAntitheftCommand("ring_start")}><Volume2 size={16}/>Faire sonner</button>
                <button className="button button-secondary" onClick={() => sendAntitheftCommand("ring_stop")}><Volume2 size={16}/>Arrêter la sonnerie</button>
              </div>
              <label className="remote-field-label" htmlFor="antitheft-message">Message à afficher dans NEXUS Agent</label>
              <input id="antitheft-message" className="remote-server-input" value={remoteMessage} maxLength={240} onChange={event => setRemoteMessage(event.target.value)} />
              <div className="heading-actions remote-actions"><button className="button button-secondary" onClick={() => sendAntitheftCommand("show_message")}><MessageSquare size={16}/>Envoyer le message</button></div>
              <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>Résultat de la dernière commande</strong><span>{remoteCommandResult}</span></div></div>
              {remoteLastLocation && <div className="security-row"><div className="security-row-icon secure"><MapPin size={16}/></div><div className="security-row-copy"><strong>Dernière position reçue</strong><span>{remoteLastLocation.latitude.toFixed(6)}, {remoteLastLocation.longitude.toFixed(6)} · précision {typeof remoteLastLocation.accuracyMeters === "number" ? Math.round(remoteLastLocation.accuracyMeters) + " m" : "inconnue"} · {remoteLastLocation.locationTime ? new Date(remoteLastLocation.locationTime).toLocaleString("fr-FR") : "date inconnue"} · {remoteLastLocation.provider || "source inconnue"}</span><a href={"https://www.openstreetmap.org/?mlat=" + remoteLastLocation.latitude + "&mlon=" + remoteLastLocation.longitude + "#map=17/" + remoteLastLocation.latitude + "/" + remoteLastLocation.longitude} target="_blank" rel="noreferrer">Ouvrir sur la carte</a></div></div>}
              <div className="info-banner"><ShieldCheck size={17}/><div><strong>Limites de cette première intégration</strong><p>Les commandes fonctionnent seulement tant que l’agent garde sa connexion WebSocket active. La localisation est la dernière position connue, pas un suivi continu. Les messages s’affichent dans l’application ouverte, pas de façon garantie sur l’écran verrouillé.</p></div></div>
            </div>
            <div className="dashboard-columns"><div className="panel"><div className="panel-header"><div><h3>Actions antivol prévues</h3><p>Fonctions à connecter à un agent autorisé et à un serveur sécurisé.</p></div><LockKeyhole size={19}/></div>
              <div className="integration-list">
                <IntegrationRow icon={<MapPin size={19}/>} name="Demander la position" description="Renvoie la dernière position connue avec horodatage et précision si disponible." status="Prototype actif" good={true}/>
                <IntegrationRow icon={<Volume2 size={19}/>} name="Faire sonner" description="Déclenche la sonnerie lorsque l’agent est connecté." status="Prototype actif" good={true}/>
                <IntegrationRow icon={<MessageSquare size={19}/>} name="Message dans l’application" description="Affiche un message dans NEXUS Agent ; l’écran verrouillé n’est pas garanti." status="Prototype actif" good={true}/>
                <IntegrationRow icon={<ShieldAlert size={19}/>} name="Alertes de sécurité" description="Recevoir les événements que l’OS et l’agent sont autorisés à observer." status="Connecteur requis" good={false}/>
                <IntegrationRow icon={<Camera size={19}/>} name="Médias d’incident" description="Toute capture doit respecter les permissions et les indicateurs système requis." status="Non activé" good={false}/>
              </div><div className="info-banner"><CircleHelp size={17}/><div><strong>Les commandes distantes sont disponibles en mode prototype.</strong><p>Le relais relaie les commandes autorisées ; l’agent Android doit rester connecté et les permissions requises doivent être accordées.</p></div></div></div>
              <div className="panel"><div className="panel-header"><div><h3>Appareil administré</h3><p>Pour un téléphone personnel ou un parc dont tu es l’administrateur.</p></div><ShieldCheck size={19}/></div>
                <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>Android Enterprise — Device Owner</strong><span>À provisionner explicitement pendant la configuration initiale ou après réinitialisation. Peut limiter la désinstallation selon les politiques autorisées.</span></div></div>
                <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>Association et révocation</strong><span>Association visible, clés individuelles et révocation depuis le PC.</span></div></div>
                <div className="security-row"><div className="security-row-icon pending"><Clock3 size={16}/></div><div className="security-row-copy"><strong>Protection contre les abus</strong><span>Commandes authentifiées, journal d’audit, chiffrement et limitation de débit.</span></div></div>
                <button className="button button-secondary full-button" onClick={() => setNotice("Consulte docs/antitheft-device-management.md. Cette interface n’active pas automatiquement Device Owner.")}>Voir les prérequis d’administration</button></div></div>
            <div className="panel security-panel"><div className="panel-header"><div><h3>Outils de cybersécurité sur Linux</h3><p>À utiliser pour tester le serveur et le réseau dans un environnement que tu contrôles.</p></div><Terminal size={19}/></div>
              <div className="security-row"><div className="security-row-icon secure"><Check size={16}/></div><div className="security-row-copy"><strong>Nmap</strong><span>Inventaire des hôtes du réseau autorisé ; cibler les tests réseau.</span></div></div>
              <div className="security-row"><div className="security-row-icon secure"><Check size={16}/></div><div className="security-row-copy"><strong>Wireshark / TShark</strong><span>Diagnostiquer les connexions et vérifier que les secrets ne circulent pas en clair.</span></div></div>
              <div className="security-row"><div className="security-row-icon secure"><Check size={16}/></div><div className="security-row-copy"><strong>OWASP ZAP</strong><span>Tester l’API du relais de test : authentification et contrôle d’accès.</span></div></div>
              <div className="security-row"><div className="security-row-icon secure"><Check size={16}/></div><div className="security-row-copy"><strong>ADB et Android Studio</strong><span>Inspecter les journaux et tester les permissions sur ton propre appareil.</span></div></div>
              <div className="info-banner"><CircleHelp size={17}/><div><strong>Kali Linux n’accorde pas automatiquement plus de droits à Android.</strong><p>Ces outils servent à auditer le système ; ils ne remplacent pas les permissions ni le provisioning Device Owner.</p></div></div></div>
          </section>}
          {page === "settings" && <section className="page-body"><LocalAISettings runtime={runtime} /><div className="settings-grid"><div className="panel setting-panel"><div className="setting-icon"><Monitor size={20}/></div><h3>Application</h3><p>Interface de bureau Tauri + React + TypeScript.</p><div className="setting-meta"><span>Version</span><strong>0.1.0 · prototype</strong></div><div className="setting-meta"><span>Environnement</span><strong>{runtime ? "Tauri Desktop" : "Aperçu navigateur"}</strong></div></div><div className="panel setting-panel"><div className="setting-icon"><Wrench size={20}/></div><h3>Outils locaux</h3><p>Détection des dépendances présentes sur ce poste.</p>{tools.length ? tools.map(tool => <div className="setting-meta" key={tool.id}><span>{tool.label}</span><strong className={tool.installed ? "text-good" : "text-muted"}>{tool.installed ? "Détecté" : "Absent"}</strong></div>) : <div className="setting-meta"><span>État</span><strong>En attente du runtime natif</strong></div>}<button className="button button-secondary full-button" onClick={() => void refreshLocal()} disabled={checking}><RefreshCw size={15}/> Vérifier les outils</button></div><div className="panel setting-panel"><div className="setting-icon"><HardDrive size={20}/></div><h3>Données locales</h3><p>La base de données locale et les sauvegardes seront ajoutées après stabilisation du modèle des appareils.</p><div className="setting-meta"><span>Serveur distant</span><strong>Non configuré</strong></div><div className="setting-meta"><span>Stockage</span><strong>Pas de données persistantes</strong></div></div></div></section>}
          <footer className="page-footer"><span>NEXUS CONTROL <span className="footer-sep">·</span> Prototype 0.1.0</span><span><span className="status-dot dot-green"/> Local d'abord, sécurisé par conception</span></footer>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon, label, value, foot, tone }: { icon: ReactNode; label: string; value: string; foot: string; tone: string }) {
  return <div className="stat-card"><div className="stat-top"><div className={`stat-icon ${tone}`}>{icon}</div><span className="stat-context">LOCAL</span></div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-foot">{foot}</div></div>;
}
function IntegrationRow({ icon, name, description, status, good }: { icon: ReactNode; name: string; description: string; status: string; good: boolean }) {
  return <div className="integration-row"><div className="integration-icon">{icon}</div><div className="integration-copy"><strong>{name}</strong><span>{description}</span></div><span className={`integration-status ${good ? "status-good" : "status-neutral"}`}><span className="status-dot"/>{status}</span></div>;
}
function QuickAction({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick: () => void }) {
  return <button className="quick-action" onClick={onClick}><div className="quick-icon">{icon}</div><div><strong>{title}</strong><span>{desc}</span></div><ArrowUpRight size={15} className="quick-arrow"/></button>;
}
function ConnectorCard({ icon, title, category, description, state, tone, action, actionLabel = "Configurer / vérifier" }: { icon: ReactNode; title: string; category: string; description: string; state: string; tone: string; action: () => void; actionLabel?: string }) {
  return <div className="connector-card"><div className="connector-top"><div className="connector-icon">{icon}</div><span className={`connector-state ${tone}`}><span className="status-dot"/>{state}</span></div><div className="connector-category">{category}</div><h3>{title}</h3><p>{description}</p><button className="connector-action" onClick={action}>{actionLabel} <ArrowUpRight size={15}/></button></div>;
}
function EmptyState({ icon, title, description, action, onAction }: { icon: ReactNode; title: string; description: string; action: string; onAction: () => void }) {
  return <div className="empty-state"><div className="empty-state-icon">{icon}</div><h3>{title}</h3><p>{description}</p><button className="button button-secondary" onClick={onAction}>{action}</button></div>;
}
function SecurityRow({ title, detail, state, good }: { title: string; detail: string; state: string; good: boolean }) {
  return <div className="security-row"><div className={`security-row-icon ${good ? "secure" : "pending"}`}>{good ? <Check size={16}/> : <Clock3 size={16}/>}</div><div className="security-row-copy"><strong>{title}</strong><span>{detail}</span></div><span className={`security-state ${good ? "secure-text" : "pending-text"}`}>{state}</span></div>;
}

export default App;
