import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Check,
  Clock3,
  Copy,
  Globe,
  HardDrive,
  Laptop,
  Link2,
  LockKeyhole,
  Monitor,
  Network,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Terminal,
  Tv,
  Wifi,
  Zap,
} from "lucide-react";
import { ScreenSharePanel } from "./ScreenSharePanel";
import "./RemoteAccessPanel.css";

export type VpnPeerInfo = {
  id: string;
  hostname: string;
  dns_name: string;
  ip: string;
  os: string;
  online: boolean;
  last_seen: string;
  rx_bytes: number;
  tx_bytes: number;
};

export type VpnTunnelReport = {
  active_engine: string;
  is_active: boolean;
  backend_state: string;
  local_ip: string | null;
  dns_name: string | null;
  hostname: string | null;
  account_user: string | null;
  peers: VpnPeerInfo[];
  supported_engines: string[];
};

type RemoteAccessPanelProps = {
  socket: WebSocket | null;
  connected: boolean;
  remoteRelayUrl: string;
  setRemoteRelayUrl: (val: string) => void;
  remotePairCode: string;
  remoteDesktopToken: string;
  remoteRelayStatus: string;
  createRemotePair: () => Promise<void>;
  revokePair: () => void;
  remotePeerRole: "android" | "windows" | null;
  sendWindowsCommand: (action: "windows_status" | "windows_list_processes" | "windows_run_powershell") => void;
  remotePowerShellScript: string;
  setRemotePowerShellScript: (val: string) => void;
  remoteCommandResult: string;
  onNotice?: (message: string) => void;
  onOpenRemoteConsole?: (url: string) => void;
};

export function RemoteAccessPanel({
  socket,
  connected,
  remoteRelayUrl,
  setRemoteRelayUrl,
  remotePairCode,
  remoteDesktopToken,
  remoteRelayStatus,
  createRemotePair,
  revokePair,
  remotePeerRole,
  sendWindowsCommand,
  remotePowerShellScript,
  setRemotePowerShellScript,
  remoteCommandResult,
  onNotice,
  onOpenRemoteConsole,
}: RemoteAccessPanelProps) {
  const [activeTab, setActiveTab] = useState<"tunnel" | "screen" | "relay">("tunnel");
  const [tunnelReport, setTunnelReport] = useState<VpnTunnelReport | null>(null);
  const [loadingTunnel, setLoadingTunnel] = useState(false);
  const [pingTarget, setPingTarget] = useState("");
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [isPinging, setIsPinging] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const fetchTunnelStatus = useCallback(async () => {
    setLoadingTunnel(true);
    try {
      const res = await invoke<VpnTunnelReport>("get_vpn_tunnel_status");
      setTunnelReport(res);
    } catch (err) {
      console.error("Erreur lors de la récupération du tunnel VPN:", err);
      onNotice?.("Impossible de sonder l'état du tunnel réseau : " + String(err));
    } finally {
      setLoadingTunnel(false);
    }
  }, [onNotice]);

  useEffect(() => {
    void fetchTunnelStatus();
    const interval = setInterval(() => {
      void fetchTunnelStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchTunnelStatus]);

  const copyToClipboard = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    onNotice?.(`Copié : ${text}`);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handlePing = async (targetIp: string) => {
    if (!targetIp.trim()) return;
    setIsPinging(true);
    setPingTarget(targetIp);
    setPingResult("Mesure de la latence NAT-traversal en cours...");
    try {
      const res = await invoke<string>("tailscale_ping_peer", { targetIp: targetIp.trim() });
      setPingResult(res);
    } catch (err) {
      setPingResult("Échec du test de traversée NAT : " + String(err));
    } finally {
      setIsPinging(false);
    }
  };

  return (
    <div className="remote-access-container">
      {/* Navigation par onglets */}
      <div className="remote-tabs">
        <button
          className={`remote-tab-btn ${activeTab === "tunnel" ? "active" : ""}`}
          onClick={() => setActiveTab("tunnel")}
        >
          <Network size={18} />
          Tunnel Maillé P2P (Zéro Configuration)
        </button>
        <button
          className={`remote-tab-btn ${activeTab === "screen" ? "active" : ""}`}
          onClick={() => setActiveTab("screen")}
        >
          <Monitor size={18} />
          Streaming d'Écran WebRTC Direct
        </button>
        <button
          className={`remote-tab-btn ${activeTab === "relay" ? "active" : ""}`}
          onClick={() => setActiveTab("relay")}
        >
          <Link2 size={18} />
          Relais Cloud & Télémaintenance
        </button>
      </div>

      {/* ONGLET 1 : TUNNEL MAILLÉ */}
      {activeTab === "tunnel" && (
        <section className="tunnel-section">
          <div className="network-hero">
            <div className="network-hero-icon">
              <Zap size={25} />
            </div>
            <div className="network-hero-copy">
              <h2>Réseau Maillé Zéro Configuration</h2>
              <p>
                Connecte tes téléphones et PC à travers le monde sans ouvrir de port sur ta box internet
                ni payer d'hébergement. Le maillage WireGuard / Tailscale traverse automatiquement les
                pare-feux et les connexions mobiles 4G/5G (CGNAT) avec un chiffrement de bout en bout.
              </p>
            </div>
            <button
              className="button button-secondary"
              onClick={() => void fetchTunnelStatus()}
              disabled={loadingTunnel}
            >
              <RefreshCw size={15} className={loadingTunnel ? "spin" : ""} />
              Actualiser
            </button>
          </div>

          <div className="tunnel-hero-grid">
            {/* État du tunnel local */}
            <div className={`tunnel-card ${tunnelReport?.is_active ? "active" : ""}`}>
              <div className="tunnel-card-header">
                <div>
                  <h3>Moteur de Tunnel Actif</h3>
                  <p>Technologie réseau P2P détectée sur cette machine</p>
                </div>
                <span className={`tunnel-badge ${tunnelReport?.is_active ? "online" : "offline"}`}>
                  <span className="status-dot" />
                  {tunnelReport?.is_active ? "Actif & Connecté" : "Inactif"}
                </span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Fournisseur</span>
                <span className="tunnel-meta-value">
                  <ShieldCheck size={16} color="#38bdf8" />
                  {tunnelReport?.active_engine || "Aucun"}
                </span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Adresse IP Maillée</span>
                <span className="tunnel-meta-value">
                  {tunnelReport?.local_ip ? (
                    <span
                      className="tunnel-ip-pill"
                      onClick={() => copyToClipboard(tunnelReport.local_ip!, "local-ip")}
                      title="Cliquer pour copier l'IP maillée"
                    >
                      {tunnelReport.local_ip}
                      {copiedKey === "local-ip" ? <Check size={12} /> : <Copy size={12} />}
                    </span>
                  ) : (
                    "Non assignée"
                  )}
                </span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Nom DNS Maillé (MagicDNS)</span>
                <span className="tunnel-meta-value" style={{ fontSize: "0.8rem", wordBreak: "break-all" }}>
                  {tunnelReport?.dns_name || "—"}
                </span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Compte authentifié</span>
                <span className="tunnel-meta-value">{tunnelReport?.account_user || "Non connecté"}</span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Outils installés</span>
                <span className="tunnel-meta-value">
                  {tunnelReport?.supported_engines.join(", ") || "Aucun outil détecté"}
                </span>
              </div>
            </div>

            {/* Avantages NAT Traversal */}
            <div className="tunnel-card">
              <div className="tunnel-card-header">
                <div>
                  <h3>Traversée NAT & Sécurité</h3>
                  <p>Protection totale sans exposition publique</p>
                </div>
                <LockKeyhole size={20} color="#22c55e" />
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Traversée CGNAT 4G/5G</span>
                <span className="tunnel-meta-value">
                  <Check size={16} color="#22c55e" /> Automatique (STUN/DERP)
                </span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Ports entrants requis</span>
                <span className="tunnel-meta-value">
                  <Check size={16} color="#22c55e" /> 0 port ouvert
                </span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Chiffrement</span>
                <span className="tunnel-meta-value">WireGuard Noise Protocol</span>
              </div>

              <div className="tunnel-meta-row">
                <span className="tunnel-meta-label">Accès Mobile Android</span>
                <span className="tunnel-meta-value">Pris en charge via l'app Tailscale</span>
              </div>

              <div style={{ marginTop: "14px" }}>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted, #94a3b8)", lineHeight: "1.4" }}>
                  💡 <strong>Astuce mobilité :</strong> Installe Tailscale ou WireGuard sur ton smartphone Android
                  avec le même compte. Ton téléphone recevra instantanément une IP privée joignable depuis ce PC,
                  où que tu sois dans le monde.
                </p>
              </div>
            </div>
          </div>

          {/* Test de latence / Ping P2P */}
          <div className="panel device-panel" style={{ marginTop: "16px" }}>
            <div className="panel-header">
              <div>
                <h3>Test de Traversée NAT & Latence P2P</h3>
                <p>Mesure la route directe établie entre ce PC et un appareil distant</p>
              </div>
              <Activity size={18} />
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "10px" }}>
              <input
                className="remote-server-input"
                style={{ flex: 1, margin: 0 }}
                placeholder="Exemple: 100.98.48.61 ou nom d'hôte de ton appareil distant"
                value={pingTarget}
                onChange={(e) => setPingTarget(e.target.value)}
              />
              <button
                className="button button-primary"
                onClick={() => void handlePing(pingTarget)}
                disabled={isPinging || !pingTarget.trim()}
              >
                <Send size={15} />
                {isPinging ? "Mesure..." : "Tester la liaison"}
              </button>
            </div>

            {pingResult && <div className="ping-result-box">{pingResult}</div>}
          </div>

          {/* Liste des pairs détectés sur le maillage */}
          <div className="panel device-panel" style={{ marginTop: "16px" }}>
            <div className="panel-header">
              <div>
                <h3>Appareils Distants dans le Maillage</h3>
                <p>Appareils autorisés et reliés à ton réseau privé virtuel</p>
              </div>
              <span className="count-pill">{tunnelReport?.peers.length || 0} appareil(s)</span>
            </div>

            {!tunnelReport?.peers || tunnelReport.peers.length === 0 ? (
              <div style={{ textAlign: "center", padding: "28px 16px", color: "var(--text-muted, #94a3b8)" }}>
                <Laptop size={32} style={{ margin: "0 auto 10px", opacity: 0.5 }} />
                <p style={{ fontWeight: 600, color: "var(--text-main, #f1f5f9)" }}>
                  Aucun autre appareil connecté sur ce compte
                </p>
                <p style={{ fontSize: "0.85rem", maxWidth: "480px", margin: "6px auto 0" }}>
                  Pour ajouter ton téléphone ou un autre ordinateur, installe Tailscale dessus et connecte-toi avec{" "}
                  <strong>{tunnelReport?.account_user || "ton compte"}</strong>.
                </p>
              </div>
            ) : (
              <div className="peers-grid">
                {tunnelReport.peers.map((peer) => (
                  <div className="peer-card" key={peer.id}>
                    <div className="peer-header">
                      <div className="peer-title">
                        {peer.os.toLowerCase().includes("android") ? (
                          <Smartphone size={18} color="#38bdf8" />
                        ) : peer.os.toLowerCase().includes("windows") ? (
                          <Monitor size={18} color="#60a5fa" />
                        ) : (
                          <Laptop size={18} color="#a78bfa" />
                        )}
                        <span>{peer.hostname}</span>
                      </div>
                      <span className={`tunnel-badge ${peer.online ? "online" : "offline"}`}>
                        {peer.online ? "En ligne" : "Hors ligne"}
                      </span>
                    </div>

                    <div className="tunnel-meta-row">
                      <span className="tunnel-meta-label">Système</span>
                      <span className="tunnel-meta-value">{peer.os}</span>
                    </div>

                    <div className="tunnel-meta-row">
                      <span className="tunnel-meta-label">IP Maillage</span>
                      <span className="tunnel-meta-value">
                        <span
                          className="tunnel-ip-pill"
                          onClick={() => copyToClipboard(peer.ip, peer.id)}
                          title="Cliquer pour copier l'IP"
                        >
                          {peer.ip}
                          {copiedKey === peer.id ? <Check size={12} /> : <Copy size={12} />}
                        </span>
                      </span>
                    </div>

                    <div className="peer-actions">
                      <button
                        className="button button-secondary"
                        style={{ flex: 1, fontSize: "0.8rem", padding: "6px" }}
                        onClick={() => void handlePing(peer.ip)}
                        disabled={isPinging}
                      >
                        <Zap size={14} /> Tester liaison
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ONGLET 2 : STREAMING D'ÉCRAN WEBRTC & DIRECT */}
      {activeTab === "screen" && (
        <section className="screen-section">
          <div className="network-hero">
            <div className="network-hero-icon">
              <Monitor size={25} />
            </div>
            <div className="network-hero-copy">
              <h2>Streaming d'Écran Intégré (Fluidité Zéro Fenêtre Externe)</h2>
              <p>
                Affiche l'écran de ton appareil distant directement dans NEXUS CONTROL sans passer par
                une fenêtre tierce. Le flux transmet les trames optimisées et respecte le consentement
                explicite de l'utilisateur distant.
              </p>
            </div>
          </div>

          <ScreenSharePanel
            socket={socket}
            connected={connected || remoteRelayStatus.includes("connecté") || remoteRelayStatus.includes("authentifié")}
            onNotice={onNotice}
          />
        </section>
      )}

      {/* ONGLET 3 : RELAIS INTERNET CLOUD & TÉLÉMAINTENANCE */}
      {activeTab === "relay" && (
        <section className="relay-section">
          <div className="panel device-panel">
            <div className="panel-header">
              <div>
                <h3>Relier un appareil par Relais Chiffré</h3>
                <p>
                  Association temporaire par code unique à 6 chiffres pour administrer un appareil distant
                  même sans VPN maillé.
                </p>
              </div>
              <span className="count-pill">WSS / TLS</span>
            </div>

            <label className="remote-field-label" htmlFor="nexus-relay-url">
              URL HTTPS du relais NEXUS
            </label>
            <input
              id="nexus-relay-url"
              className="remote-server-input"
              type="url"
              placeholder="https://relais.ton-domaine.tld"
              value={remoteRelayUrl}
              onChange={(e) => setRemoteRelayUrl(e.target.value)}
            />

            <div className="heading-actions remote-actions">
              <button
                className="button button-primary"
                disabled={!remoteRelayUrl.trim()}
                onClick={() => void createRemotePair()}
              >
                <Link2 size={16} />
                Créer un code d'association
              </button>
            </div>

            {remotePairCode && (
              <div className="security-row">
                <div className="security-row-icon secure">
                  <LockKeyhole size={16} />
                </div>
                <div className="security-row-copy">
                  <strong>Code temporaire : {remotePairCode}</strong>
                  <span>À saisir sur l’appareil cible dans les 5 minutes. Ne le partage pas publiquement.</span>
                </div>
                <button
                  className="button button-secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(remotePairCode);
                    onNotice?.("Code d'association copié !");
                  }}
                >
                  <Copy size={14} /> Copier
                </button>
              </div>
            )}

            <div className="security-row">
              <div className="security-row-icon pending">
                <Clock3 size={16} />
              </div>
              <div className="security-row-copy">
                <strong>État de la liaison relais</strong>
                <span>{remoteRelayStatus}</span>
              </div>
            </div>

            {remoteDesktopToken && (
              <div className="heading-actions remote-actions" style={{ marginTop: "12px" }}>
                <button className="button button-secondary" onClick={revokePair}>
                  <LockKeyhole size={16} />
                  Révoquer cette association
                </button>
              </div>
            )}
          </div>

          {/* Si un agent Windows est appairé */}
          {remotePeerRole === "windows" && (
            <div className="panel device-panel" style={{ marginTop: "16px" }}>
              <div className="panel-header">
                <div>
                  <h3>Contrôle Windows Distant</h3>
                  <p>Commandes transmises à l'agent Windows authentifié</p>
                </div>
                <Terminal size={20} />
              </div>

              <div className="heading-actions remote-actions">
                <button className="button button-secondary" onClick={() => sendWindowsCommand("windows_status")}>
                  <Monitor size={16} />
                  État du PC
                </button>
                <button className="button button-secondary" onClick={() => sendWindowsCommand("windows_list_processes")}>
                  <Activity size={16} />
                  Lister les processus
                </button>
              </div>

              <label className="remote-field-label" htmlFor="windows-powershell-script" style={{ marginTop: "12px" }}>
                Script PowerShell (limite 8000 caractères)
              </label>
              <textarea
                id="windows-powershell-script"
                className="remote-server-input"
                rows={5}
                value={remotePowerShellScript}
                onChange={(e) => setRemotePowerShellScript(e.target.value)}
                spellCheck={false}
              />

              <div className="heading-actions remote-actions">
                <button className="button button-primary" onClick={() => sendWindowsCommand("windows_run_powershell")}>
                  <Terminal size={16} />
                  Exécuter sur Windows distant
                </button>
              </div>

              <div className="security-row">
                <div className="security-row-icon pending">
                  <Clock3 size={16} />
                </div>
                <div className="security-row-copy">
                  <strong>Résultat de l'exécution</strong>
                  <span style={{ whiteSpace: "pre-wrap" }}>{remoteCommandResult}</span>
                </div>
              </div>
            </div>
          )}

          {/* Liens MeshCentral / RustDesk */}
          <div className="panel device-panel" style={{ marginTop: "16px" }}>
            <div className="panel-header">
              <div>
                <h3>Solutions de Secours Multiplateformes</h3>
                <p>Consoles tierces compatibles</p>
              </div>
              <Globe size={18} />
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "8px" }}>
              <button
                className="button button-secondary"
                onClick={() => onOpenRemoteConsole?.("https://rustdesk.com/")}
              >
                <Globe size={15} />
                Ouvrir RustDesk
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
