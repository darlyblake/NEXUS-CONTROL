import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity, AlertCircle, Apple, ArrowDownToLine, ArrowUpRight, Bot, Check,
  ChevronDown, CircleHelp, Clock3, Command, Cpu, FileText, Folder, Gauge,
  HardDrive, LayoutDashboard, Link2, LockKeyhole, Monitor, MonitorSmartphone,
  MoreHorizontal, Network, Plus, Radar, RefreshCw, Search, Settings2, ShieldCheck,
  Smartphone, Terminal, Tv, Wifi, WifiOff, Workflow, Wrench, Zap
} from "lucide-react";

type Page = "overview" | "devices" | "remote" | "network" | "integrations" | "automations" | "activity" | "security" | "settings";
type NetworkDevice = { ip: string; hostname: string; mac: string; kind: string };
type LocalTool = { id: string; label: string; installed: boolean; detail: string };
type AuditCheck = { id: string; label: string; status: string; detail: string };
type AndroidDevice = { id: string; state: string; model: string };
type UpdateInfo = { currentVersion: string; version: string; downloadUrl: string; checksumUrl: string; assetName: string; notes: string };

const nav: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Vue d'ensemble", icon: LayoutDashboard },
  { id: "devices", label: "Mes appareils", icon: MonitorSmartphone },
  { id: "remote", label: "Accès distant", icon: Link2 },
  { id: "network", label: "Analyse réseau", icon: Radar },
  { id: "integrations", label: "Intégrations", icon: Network },
  { id: "automations", label: "Automatisations", icon: Workflow },
  { id: "activity", label: "Journal d'activité", icon: Activity },
];
const secondaryNav: { id: Page; label: string; icon: typeof ShieldCheck }[] = [
  { id: "security", label: "Sécurité", icon: ShieldCheck },
  { id: "settings", label: "Paramètres", icon: Settings2 },
];

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  overview: { title: "Vue d'ensemble", subtitle: "L'état de ton centre de contrôle, en un seul endroit." },
  devices: { title: "Mes appareils", subtitle: "Appareils enregistrés et appareils détectés localement." },
  remote: { title: "Accès distant", subtitle: "Prépare une connexion Internet sécurisée vers un serveur distant autorisé." },
  network: { title: "Analyse réseau", subtitle: "Découvre les appareils qui répondent sur le même réseau local." },
  integrations: { title: "Intégrations", subtitle: "Connecteurs logiciels utilisés par NEXUS CONTROL." },
  automations: { title: "Automatisations", subtitle: "Prépare des tâches répétables, avec contrôle et journalisation." },
  activity: { title: "Journal d'activité", subtitle: "Historique des vérifications et des opérations locales." },
  security: { title: "Sécurité", subtitle: "Les accès distants restent désactivés tant qu'ils ne sont pas configurés." },
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
  const [networkScanning, setNetworkScanning] = useState(false);
  const [connectingIp, setConnectingIp] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [installingIntegration, setInstallingIntegration] = useState<string | null>(null);
  const [runtime, setRuntime] = useState(isDesktopRuntime());
  const [notice, setNotice] = useState("Bienvenue dans NEXUS CONTROL. Les connecteurs ne sont pas encore configurés.");
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [remoteServerUrl, setRemoteServerUrl] = useState(() => { try { return localStorage.getItem("nexus.remoteServerUrl") || ""; } catch { return ""; } });
  const [openingRemoteConsole, setOpeningRemoteConsole] = useState(false);
  const [auditChecks, setAuditChecks] = useState<AuditCheck[]>([]);
  const [runningAudit, setRunningAudit] = useState(false);

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
  }, [refreshLocal]);

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
              {page === "devices" && <button className="button button-primary" onClick={() => { setPage("integrations"); setNotice("Configure un connecteur avant d'ajouter un appareil."); }}><Plus size={16}/> Configurer un appareil</button>}
            </div>
          </div>

          {notice && <div className="notice-line"><span className="notice-indicator"><AlertCircle size={15}/></span><span>{notice}</span>{updateAvailable && <button className="button button-primary button-small" disabled={installingUpdate} onClick={() => void installAppUpdate()}>{installingUpdate ? "Installation…" : "Installer la mise à jour"}</button>}<button aria-label="Fermer le message" onClick={() => setNotice("")}>×</button></div>}

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
            <div className="filter-bar"><div className="search-box"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un appareil Android…" /></div><div className="heading-actions"><button className="button button-secondary" onClick={() => void recoverBrokenScreen()} disabled={checking}><Smartphone size={15}/>{checking ? "Diagnostic…" : "Écran cassé ? Récupérer l'accès"}</button><button className="button button-secondary" onClick={() => void refreshLocal()} disabled={checking}><RefreshCw size={15} className={checking ? "spin" : ""}/> Scanner via ADB</button></div></div>
            <div className="panel device-panel"><div className="panel-header"><div><h3>Appareils Android détectés</h3><p>Les appareils sont listés uniquement si ADB les retourne réellement.</p></div><span className="count-pill">{filteredAndroid.length} trouvé(s)</span></div>
              {filteredAndroid.length === 0 ? <EmptyState icon={<Smartphone size={24}/>} title="Aucun appareil Android détecté" description="Branche un téléphone avec un câble USB de données, active le débogage USB et autorise cet ordinateur. Puis lance un nouveau scan." action="Voir les instructions" onAction={() => { setNotice("Dans un terminal : adb devices. Si le téléphone affiche unauthorized, confirme l'autorisation RSA sur l'écran du téléphone."); }}/> :
              <div className="table-wrap"><table><thead><tr><th>APPAREIL</th><th>IDENTIFIANT</th><th>ÉTAT ADB</th><th>CONTRÔLE</th></tr></thead><tbody>{filteredAndroid.map((device) => <tr key={device.id}><td><div className="device-cell"><div className="device-icon"><Smartphone size={18}/></div><div><strong>{device.model || "Appareil Android"}</strong><span>Android / ADB</span></div></div></td><td className="mono">{device.id}</td><td><span className={`state-pill ${device.state === "device" ? "state-ready" : "state-warn"}`}><span className="status-dot"/>{device.state}</span></td><td><button className="button button-secondary button-small" disabled={!runtime || device.state !== "device" || !tools.some(t => t.id === "scrcpy" && t.installed)} onClick={() => void invoke("launch_scrcpy", { serial: device.id }).then(() => setNotice("scrcpy a été lancé pour " + device.id + ".")).catch((error) => setNotice("Impossible de lancer scrcpy : " + String(error)))}>Écran distant</button></td></tr>)}</tbody></table></div>}
            </div>
            <div className="info-banner"><CircleHelp size={17}/><div><strong>Les autres appareils apparaîtront ici après intégration.</strong><p>Windows/Linux via MeshCentral, Android TV via le connecteur compatible, et Apple selon les capacités de gestion autorisées.</p></div></div>
          </section>}


          {page === "remote" && <section className="page-body">
            <div className="network-hero">
              <div className="network-hero-icon"><Link2 size={25}/></div>
              <div className="network-hero-copy"><h2>Relier des appareils par Internet</h2><p>Configure l'adresse HTTPS de ton serveur MeshCentral. Les appareils distants doivent y être enregistrés avec un agent autorisé. NEXUS CONTROL n'ouvre aucun port entrant sur cet ordinateur.</p></div>
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
              <div className="network-hero-copy"><h2>Appareils du réseau local</h2><p>Recherche avec Nmap (découverte sans scan de ports), arp-scan si disponible, puis ping et table ARP en secours. Clique sur un appareil pour afficher ses informations et tenter une connexion Android autorisée.</p></div>
              <button className="button button-primary" onClick={() => void scanNetwork()} disabled={networkScanning}><Radar size={16} className={networkScanning ? "spin" : ""}/>{networkScanning ? "Analyse en cours…" : "Lancer l'analyse"}</button>
            </div>
            <div className="network-summary">
              <div><span className="network-summary-label">Appareils détectés</span><strong>{networkDevices.length}</strong></div>
              <div><span className="network-summary-label">Méthodes</span><strong>Nmap · ARP · Ping</strong></div>
              <div><span className="network-summary-label">Connexion</span><strong>Après autorisation de l'appareil</strong></div>
            </div>
            <div className="panel device-panel">
              <div className="panel-header"><div><h3>Résultats du scan</h3><p>Adresse IP, nom réseau et adresse MAC lorsqu'ils sont disponibles.</p></div><span className="count-pill">{networkDevices.length} appareil(s)</span></div>
              {networkScanning && networkDevices.length === 0 ? <div className="network-empty"><Radar size={27} className="spin"/><strong>Recherche des appareils sur le réseau…</strong><span>Cette opération peut prendre quelques secondes.</span></div> :
              networkDevices.length === 0 ? <EmptyState icon={<Wifi size={24}/>} title="Aucun appareil trouvé pour le moment" description="Vérifie que le Wi-Fi est connecté et que les appareils sont sur le même réseau. Installe Nmap pour améliorer la découverte (Ubuntu : sudo apt install nmap). arp-scan peut compléter les résultats avec sudo apt install arp-scan, mais nécessite parfois des permissions supplémentaires. Certains appareils restent invisibles." action="Réessayer" onAction={() => void scanNetwork()}/> :
              <div className="network-device-grid">{networkDevices.map((device) => <article className="network-device-card" key={device.ip}>
                <div className="network-device-top"><div className="network-device-icon">{device.kind.toLowerCase().includes("android") || device.hostname.toLowerCase().includes("tecno") ? <Smartphone size={20}/> : <MonitorSmartphone size={20}/>}</div><span className="state-pill state-ready"><span className="status-dot"/>En ligne</span></div>
                <h3>{device.hostname || "Appareil sans nom"}</h3><p className="network-device-kind">{device.kind}</p>
                <div className="network-info-row"><span>Adresse IP</span><strong className="mono">{device.ip}</strong></div>
                <div className="network-info-row"><span>Adresse MAC</span><strong className="mono">{device.mac || "Non disponible"}</strong></div>
                <div className="network-info-row"><span>Nom réseau</span><strong>{device.hostname || "Non communiqué"}</strong></div>
                <button className="button button-secondary full-button" disabled={!!connectingIp || !tools.some(t => t.id === "adb" && t.installed)} onClick={() => void connectNetworkAndroid(device.ip)}>{connectingIp === device.ip ? <><RefreshCw size={14} className="spin"/> Connexion…</> : <><Wifi size={14}/> Tenter la connexion Android</>}</button>
              </article>)}</div>}
            </div>
            <div className="info-banner"><CircleHelp size={17}/><div><strong>À savoir sur Android</strong><p>Le scan est automatique, mais Android n'autorise pas le contrôle à distance simplement parce qu'il est sur le même Wi-Fi. La connexion se fera si le débogage sans fil est actif et si ADB a déjà été autorisé/appairé. Si ce n'est pas le cas, l'application expliquera ce qui manque au lieu de contourner la sécurité du téléphone.</p></div></div>
          </section>}

          {page === "integrations" && <section className="page-body">
            <div className="integration-grid">
              <ConnectorCard icon={<Monitor size={23}/>} title="MeshCentral" category="Ordinateurs Windows / Linux" description="Installe le serveur local depuis un script adapté à Windows ou Linux, puis démarre sa console de configuration." state={tools.find(t => t.id === "meshcentral")?.installed ? "Installé localement" : "Installation requise"} tone={tools.find(t => t.id === "meshcentral")?.installed ? "good" : "neutral"} actionLabel={installingIntegration === "meshcentral" ? "Préparation…" : "Installer / configurer"} action={() => void installIntegration("meshcentral")}/>
              <ConnectorCard icon={<Smartphone size={23}/>} title="scrcpy + ADB" category="Android" description="Affichage et contrôle de l'écran via USB ou réseau local autorisé. Le débogage USB doit être approuvé sur le téléphone." state={tools.some(t => t.id === "adb" && t.installed) && tools.some(t => t.id === "scrcpy" && t.installed) ? "Outils détectés" : "Installation requise"} tone={tools.some(t => t.id === "adb" && t.installed) && tools.some(t => t.id === "scrcpy" && t.installed) ? "good" : "neutral"} action={() => void refreshLocal()}/>
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

          {page === "settings" && <section className="page-body"><div className="settings-grid"><div className="panel setting-panel"><div className="setting-icon"><Monitor size={20}/></div><h3>Application</h3><p>Interface de bureau Tauri + React + TypeScript.</p><div className="setting-meta"><span>Version</span><strong>0.1.0 · prototype</strong></div><div className="setting-meta"><span>Environnement</span><strong>{runtime ? "Tauri Desktop" : "Aperçu navigateur"}</strong></div></div><div className="panel setting-panel"><div className="setting-icon"><Wrench size={20}/></div><h3>Outils locaux</h3><p>Détection des dépendances présentes sur ce poste.</p>{tools.length ? tools.map(tool => <div className="setting-meta" key={tool.id}><span>{tool.label}</span><strong className={tool.installed ? "text-good" : "text-muted"}>{tool.installed ? "Détecté" : "Absent"}</strong></div>) : <div className="setting-meta"><span>État</span><strong>En attente du runtime natif</strong></div>}<button className="button button-secondary full-button" onClick={() => void refreshLocal()} disabled={checking}><RefreshCw size={15}/> Vérifier les outils</button></div><div className="panel setting-panel"><div className="setting-icon"><HardDrive size={20}/></div><h3>Données locales</h3><p>La base de données locale et les sauvegardes seront ajoutées après stabilisation du modèle des appareils.</p><div className="setting-meta"><span>Serveur distant</span><strong>Non configuré</strong></div><div className="setting-meta"><span>Stockage</span><strong>Pas de données persistantes</strong></div></div></div></section>}
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
