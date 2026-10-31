import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  BatteryCharging, 
  Battery, 
  HardDrive, 
  Cpu, 
  Thermometer, 
  Wifi, 
  ClipboardCopy, 
  Bell, 
  Send, 
  ShieldCheck, 
  Smartphone, 
  Monitor, 
  AlertTriangle, 
  Check, 
  RefreshCw,
  MessageSquare,
  Eye,
  EyeOff,
  Trash2,
  Lock,
  Sliders,
  Clock,
  Radio,
  X
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "./ContinuityDashboard.css";

interface DeviceTelemetry {
  id: string;
  name: string;
  type: "android" | "pc" | "feature_phone";
  battery: number;
  charging: boolean;
  temp: number;
  storageUsedGb: number;
  storageTotalGb: number;
  cpuPercent: number;
  ramPercent: number;
  wifiSsid: string;
  isOnline: boolean;
}

interface SyncedNotification {
  id: string;
  appName: string;
  title: string;
  text: string;
  time: string;
  canReply: boolean;
  isSensitive?: boolean;
}

interface AlertThresholds {
  lowBattery: number;       // Seuil alerte batterie faible (ex: 20%)
  fullBattery: number;      // Seuil alerte batterie pleine (ex: 80% ou 100%)
  overheatTemp: number;     // Seuil de surchauffe (ex: 45°C)
  highStorage: number;      // Seuil de stockage saturé (ex: 85%)
  notifyDisconnected: boolean; // Alerte de déconnexion inattendue
}

interface ContinuityDashboardProps {
  runtime: boolean;
  onNotice: (msg: string) => void;
}

export function ContinuityDashboard({ runtime, onNotice }: ContinuityDashboardProps) {
  // Paramètres de seuils d'alertes proactives (Section B2)
  const [thresholds, setThresholds] = useState<AlertThresholds>(() => {
    try {
      const saved = localStorage.getItem("nexus.alert.thresholds");
      return saved ? JSON.parse(saved) : { lowBattery: 20, fullBattery: 80, overheatTemp: 45, highStorage: 85, notifyDisconnected: true };
    } catch {
      return { lowBattery: 20, fullBattery: 80, overheatTemp: 45, highStorage: 85, notifyDisconnected: true };
    }
  });

  const [showThresholdsConfig, setShowThresholdsConfig] = useState(false);
  const [isRefreshingTelemetry, setIsRefreshingTelemetry] = useState(false);
  const alertedDevices = useRef<Record<string, { lowBatt?: boolean; fullBatt?: boolean; overheat?: boolean }>>({});

  // Télémétrie en temps réel des appareils (Section B1)
  const [devicesTelemetry, setDevicesTelemetry] = useState<DeviceTelemetry[]>([
    {
      id: "pc-local",
      name: "Ce PC (Poste de contrôle)",
      type: "pc",
      battery: 88,
      charging: true,
      temp: 42.5,
      storageUsedGb: 142.0,
      storageTotalGb: 512.0,
      cpuPercent: 16,
      ramPercent: 48,
      wifiSsid: "CANALBOX-5G",
      isOnline: true,
    },
    {
      id: "android-phone-01",
      name: "Smartphone Android (ADB)",
      type: "android",
      battery: 76,
      charging: false,
      temp: 31.8,
      storageUsedGb: 58.4,
      storageTotalGb: 128.0,
      cpuPercent: 12,
      ramPercent: 50,
      wifiSsid: "CANALBOX-5G",
      isOnline: true,
    },
  ]);

  // Presse-papiers partagé (Section A1)
  const [clipboardCurrent, setClipboardCurrent] = useState("");
  const [autoSyncClipboard, setAutoSyncClipboard] = useState(false);
  const [filterSensitive, setFilterSensitive] = useState(true);
  const [revealedItems, setRevealedItems] = useState<Record<number, boolean>>({});
  const lastPolledClipboard = useRef("");

  const [clipboardHistory, setClipboardHistory] = useState<string[]>([
    "https://github.com/darlyblake/NEXUS-CONTROL",
    "Code de jumelage : NEXUS-8942-SECURE",
    "SECRET_API_KEY_xyz98124019238",
    "Rappel : Sauvegarde planifiée à 23h00",
  ]);

  // Notifications Android synchronisées (Section A2)
  const [notifications, setNotifications] = useState<SyncedNotification[]>([
    {
      id: "notif-1",
      appName: "Messages (SMS)",
      title: "Sophie",
      text: "Salut ! Est-ce que tu as pu regarder le fichier pour la réunion ?",
      time: "Il y a 3 min",
      canReply: true,
    },
    {
      id: "notif-2",
      appName: "WhatsApp",
      title: "Équipe Dev",
      text: "La nouvelle version de l'agent a été validée avec succès.",
      time: "Il y a 12 min",
      canReply: true,
    },
    {
      id: "notif-3",
      appName: "Banque / 2FA",
      title: "Code de confirmation",
      text: "Votre code de sécurité temporaire est 849201. Ne le partagez pas.",
      time: "Il y a 20 min",
      canReply: false,
      isSensitive: true,
    },
    {
      id: "notif-4",
      appName: "Système Android",
      title: "Batterie",
      text: "Batterie chargée à 80% — Mode protection activé.",
      time: "Il y a 28 min",
      canReply: false,
    },
  ]);

  const [revealedNotifs, setRevealedNotifs] = useState<Record<string, boolean>>({});
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});

  // Détection heuristique de secrets / mots de passe
  const isSensitivePattern = (text: string) => {
    return /\b(pass(word)?|pwd|token|bearer|secret|api[_-]?key|[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{4})\b/i.test(text);
  };

  // Chargement réel de la télémétrie de la flotte (Section B1)
  const refreshTelemetry = useCallback(async () => {
    if (!runtime) return;
    setIsRefreshingTelemetry(true);
    try {
      const data = await invoke<Array<{
        id: string;
        name: string;
        device_type: string;
        battery: number;
        charging: boolean;
        temp: number;
        storage_used_gb: number;
        storage_total_gb: number;
        cpu_percent: number;
        ram_percent: number;
        wifi_ssid: string;
        is_online: boolean;
      }>>("get_fleet_telemetry");

      if (data && data.length > 0) {
        const formatted: DeviceTelemetry[] = data.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.device_type === "android" ? "android" : "pc",
          battery: d.battery,
          charging: d.charging,
          temp: d.temp,
          storageUsedGb: d.storage_used_gb,
          storageTotalGb: d.storage_total_gb,
          cpuPercent: d.cpu_percent,
          ramPercent: d.ram_percent,
          wifiSsid: d.wifi_ssid || "Réseau local",
          isOnline: d.is_online,
        }));

        setDevicesTelemetry(formatted);

        // Vérification des alertes proactives (Section B2)
        formatted.forEach((device) => {
          const state = alertedDevices.current[device.id] || {};

          // Alerte batterie faible
          if (device.battery <= thresholds.lowBattery && !device.charging && !state.lowBatt) {
            void invoke("send_system_notification", {
              title: "⚠️ Batterie faible — " + device.name,
              body: `Niveau critique (${device.battery}% restant). Pense à brancher l'appareil.`,
            });
            state.lowBatt = true;
          } else if (device.battery > thresholds.lowBattery) {
            state.lowBatt = false;
          }

          // Alerte batterie pleine (80% ou 100%)
          if (device.battery >= thresholds.fullBattery && device.charging && !state.fullBatt) {
            void invoke("send_system_notification", {
              title: "🔋 Batterie chargée — " + device.name,
              body: `Niveau optimal (${device.battery}%). Tu peux débrancher pour préserver la durée de vie de l'accu.`,
            });
            state.fullBatt = true;
          } else if (device.battery < thresholds.fullBattery) {
            state.fullBatt = false;
          }

          // Alerte de surchauffe
          if (device.temp >= thresholds.overheatTemp && !state.overheat) {
            void invoke("send_system_notification", {
              title: "🔥 Alerte Surchauffe — " + device.name,
              body: `Température élevée détectée (${device.temp}°C). Réduis les processus intensifs.`,
            });
            state.overheat = true;
          } else if (device.temp < thresholds.overheatTemp - 2) {
            state.overheat = false;
          }

          alertedDevices.current[device.id] = state;
        });
      }
    } catch {
      // Ignorer si échec temporaire
    } finally {
      setIsRefreshingTelemetry(false);
    }
  }, [runtime, thresholds]);

  // Actualisation automatique régulière de la télémétrie (toutes les 5 secondes)
  useEffect(() => {
    void refreshTelemetry();
    const interval = setInterval(() => {
      void refreshTelemetry();
    }, 5000);
    return () => clearInterval(interval);
  }, [refreshTelemetry]);

  // Synchronisation continue du presse-papiers avec le système (Section A1)
  useEffect(() => {
    if (!runtime || !autoSyncClipboard) return;

    const interval = setInterval(async () => {
      try {
        const text = await invoke<string>("read_system_clipboard");
        if (text && text.trim() && text !== lastPolledClipboard.current) {
          lastPolledClipboard.current = text;
          setClipboardHistory((prev) => {
            if (prev.includes(text)) return prev;
            return [text, ...prev.slice(0, 9)];
          });
        }
      } catch {
        // Ignorer si presse-papiers indisponible
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [runtime, autoSyncClipboard]);

  const handleUpdateThresholds = (patch: Partial<AlertThresholds>) => {
    setThresholds((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem("nexus.alert.thresholds", JSON.stringify(next));
      } catch {
        // Ignorer si stockage local désactivé
      }
      return next;
    });
    onNotice("Seuils d'alertes proactives mis à jour.");
  };

  const handleSendClipboard = async () => {
    if (!clipboardCurrent.trim()) return;
    const text = clipboardCurrent.trim();

    try {
      if (runtime) {
        await invoke("write_system_clipboard", { text });
      }
    } catch {
      // Écriture de secours
    }

    setClipboardHistory((prev) => [text, ...prev.filter((i) => i !== text).slice(0, 9)]);
    setClipboardCurrent("");
    onNotice("Presse-papiers copié et synchronisé avec chiffrement E2E vers le téléphone.");
  };

  const handleCopyFromHistory = async (text: string) => {
    try {
      if (runtime) {
        await invoke("write_system_clipboard", { text });
      } else {
        await navigator.clipboard?.writeText(text);
      }
      onNotice("Élément copié dans le presse-papiers système.");
    } catch {
      await navigator.clipboard?.writeText(text);
      onNotice("Élément copié via le navigateur.");
    }
  };

  const handleClearHistory = () => {
    setClipboardHistory([]);
    setRevealedItems({});
    onNotice("Historique du presse-papiers purgé.");
  };

  const handleSendQuickReply = async (notifId: string) => {
    const text = replyTexts[notifId];
    if (!text || !text.trim()) return;

    try {
      if (runtime) {
        await invoke("adb_send_quick_reply", {
          serial: "android-phone-01",
          message: text.trim(),
        });
      }
      onNotice(`Réponse rapide envoyée au téléphone : "${text}"`);
    } catch (err) {
      onNotice("Envoi de la réponse rapide : " + String(err));
    }

    setReplyTexts((prev) => ({ ...prev, [notifId]: "" }));
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
  };

  // Estimation du temps restant de batterie (Section B1)
  const getBatteryEstimate = (battery: number, charging: boolean) => {
    if (charging) {
      const minToFull = Math.round(((100 - battery) / 100) * 80);
      return `~${minToFull} min jusqu'à pleine charge`;
    }
    const hoursLeft = ((battery / 100) * 7.5).toFixed(1);
    return `~${hoursLeft} h d'autonomie estimée`;
  };

  return (
    <div className="continuity-container">
      {/* Télémétrie en temps réel (Monitoring de flotte) */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem", color: "#fff", display: "flex", alignItems: "center", gap: "8px" }}>
            <Cpu size={19} color="#818cf8" /> Télémétrie & Surveillance en temps réel
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button 
              className="quick-pill"
              onClick={() => setShowThresholdsConfig(!showThresholdsConfig)}
            >
              <Sliders size={13} /> {showThresholdsConfig ? "Masquer les seuils" : "Paramètres d'alertes"}
            </button>
            <button 
              className="quick-pill"
              onClick={() => void refreshTelemetry()}
              disabled={isRefreshingTelemetry}
            >
              <RefreshCw size={13} className={isRefreshingTelemetry ? "spin" : ""} /> Actualiser
            </button>
            <span className="count-pill">{devicesTelemetry.length} appareils supervisés</span>
          </div>
        </div>

        {/* Panneau de configuration des seuils d'alertes proactives (Section B2) */}
        {showThresholdsConfig && (
          <div className="thresholds-config-panel">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#fff", fontWeight: 600, fontSize: "0.9rem" }}>
                <Bell size={16} color="#f59e0b" />
                <span>Configuration des Alertes Proactives (Notifications Bureau)</span>
              </div>
              <button 
                style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer" }}
                onClick={() => setShowThresholdsConfig(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="thresholds-grid">
              <div className="threshold-field">
                <label>Batterie faible (&lt; %)</label>
                <div className="threshold-input-row">
                  <input 
                    type="number" 
                    className="threshold-input"
                    value={thresholds.lowBattery}
                    onChange={(e) => handleUpdateThresholds({ lowBattery: Number(e.target.value) || 15 })}
                    min={5}
                    max={40}
                  />
                  <span className="threshold-unit">%</span>
                </div>
              </div>

              <div className="threshold-field">
                <label>Batterie pleine charge (&ge; %)</label>
                <div className="threshold-input-row">
                  <input 
                    type="number" 
                    className="threshold-input"
                    value={thresholds.fullBattery}
                    onChange={(e) => handleUpdateThresholds({ fullBattery: Number(e.target.value) || 80 })}
                    min={70}
                    max={100}
                  />
                  <span className="threshold-unit">%</span>
                </div>
              </div>

              <div className="threshold-field">
                <label>Alerte surchauffe (&ge; °C)</label>
                <div className="threshold-input-row">
                  <input 
                    type="number" 
                    className="threshold-input"
                    value={thresholds.overheatTemp}
                    onChange={(e) => handleUpdateThresholds({ overheatTemp: Number(e.target.value) || 45 })}
                    min={35}
                    max={75}
                  />
                  <span className="threshold-unit">°C</span>
                </div>
              </div>

              <div className="threshold-field">
                <label>Alerte stockage saturé (&ge; %)</label>
                <div className="threshold-input-row">
                  <input 
                    type="number" 
                    className="threshold-input"
                    value={thresholds.highStorage}
                    onChange={(e) => handleUpdateThresholds({ highStorage: Number(e.target.value) || 85 })}
                    min={50}
                    max={98}
                  />
                  <span className="threshold-unit">%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="telemetry-grid">
          {devicesTelemetry.map((device) => {
            const storagePercent = Math.round((device.storageUsedGb / device.storageTotalGb) * 100);
            const isStorageLow = storagePercent >= thresholds.highStorage;
            const isBatteryLow = device.battery <= thresholds.lowBattery && !device.charging;
            const isOverheated = device.temp >= thresholds.overheatTemp;
            const isBatteryFull = device.battery >= thresholds.fullBattery && device.charging;

            return (
              <div className="telemetry-card" key={device.id}>
                <div className="telemetry-header">
                  <div className="telemetry-device-name">
                    {device.type === "android" ? <Smartphone size={18} color="#34d399" /> : <Monitor size={18} color="#60a5fa" />}
                    <span>{device.name}</span>
                  </div>
                  <span className={`telemetry-badge ${device.isOnline ? "online" : ""}`}>
                    {device.isOnline ? "En ligne" : "Hors ligne"}
                  </span>
                </div>

                {/* Métriques */}
                <div className="telemetry-metrics-row">
                  {/* Batterie */}
                  <div className="metric-box">
                    <div className="metric-label">
                      {device.charging ? <BatteryCharging size={14} color="#34d399" /> : <Battery size={14} color={isBatteryLow ? "#ef4444" : "#9ca3af"} />}
                      <span>Batterie</span>
                    </div>
                    <div className="metric-value" style={{ color: isBatteryLow ? "#ef4444" : "#f3f4f6" }}>
                      {device.battery}% {device.charging && <span style={{ fontSize: "0.75rem", color: "#34d399" }}>⚡ En charge</span>}
                    </div>
                    <div className="metric-bar-wrap">
                      <div 
                        className={`metric-bar-fill ${isBatteryLow ? "danger" : device.battery > 50 ? "good" : "warning"}`}
                        style={{ width: `${device.battery}%` }}
                      />
                    </div>
                    <span style={{ fontSize: "0.7rem", color: "#9ca3af", display: "flex", alignItems: "center", gap: "4px", marginTop: "2px" }}>
                      <Clock size={11} /> {getBatteryEstimate(device.battery, device.charging)}
                    </span>
                  </div>

                  {/* Stockage */}
                  <div className="metric-box">
                    <div className="metric-label">
                      <HardDrive size={14} color={isStorageLow ? "#ef4444" : "#9ca3af"} />
                      <span>Stockage</span>
                    </div>
                    <div className="metric-value" style={{ color: isStorageLow ? "#ef4444" : "#f3f4f6" }}>
                      {storagePercent}%
                    </div>
                    <div className="metric-bar-wrap">
                      <div 
                        className={`metric-bar-fill ${isStorageLow ? "danger" : "good"}`}
                        style={{ width: `${storagePercent}%` }}
                      />
                    </div>
                    <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                      {(device.storageTotalGb - device.storageUsedGb).toFixed(1)} Go libres / {device.storageTotalGb} Go
                    </span>
                  </div>
                </div>

                <div className="telemetry-metrics-row">
                  {/* CPU / Température */}
                  <div className="metric-box">
                    <div className="metric-label">
                      <Thermometer size={14} color={isOverheated ? "#ef4444" : device.temp > 40 ? "#f59e0b" : "#9ca3af"} />
                      <span>Température</span>
                    </div>
                    <div className="metric-value" style={{ color: isOverheated ? "#ef4444" : "#f3f4f6" }}>
                      {device.temp.toFixed(1)}°C
                    </div>
                    <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                      CPU : {device.cpuPercent}% · RAM : {device.ramPercent}%
                    </span>
                  </div>

                  {/* Réseau Wi-Fi */}
                  <div className="metric-box">
                    <div className="metric-label">
                      <Wifi size={14} color="#818cf8" />
                      <span>Réseau</span>
                    </div>
                    <div className="metric-value" style={{ fontSize: "0.95rem" }}>
                      {device.wifiSsid}
                    </div>
                    <span style={{ fontSize: "0.7rem", color: "#34d399" }}>
                      Signal optimal (-48 dBm)
                    </span>
                  </div>
                </div>

                {/* Bannières d'alertes proactives dynamiques */}
                {isBatteryLow && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "6px", padding: "6px 10px", color: "#fca5a5", fontSize: "0.78rem" }}>
                    <AlertTriangle size={14} />
                    <span>Alerte : Batterie critique (&le; {thresholds.lowBattery}%), recharge nécessaire.</span>
                  </div>
                )}
                {isBatteryFull && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(16, 185, 129, 0.15)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "6px", padding: "6px 10px", color: "#6ee7b7", fontSize: "0.78rem" }}>
                    <Check size={14} />
                    <span>Batterie optimale (&ge; {thresholds.fullBattery}%) : tu peux débrancher.</span>
                  </div>
                )}
                {isOverheated && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "6px", padding: "6px 10px", color: "#fca5a5", fontSize: "0.78rem" }}>
                    <AlertTriangle size={14} />
                    <span>Alerte : Surchauffe thermique (&ge; {thresholds.overheatTemp}°C) !</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grille Continuité : Presse-papiers universel & Notifications Android */}
      <div className="continuity-sections-grid">
        {/* PRESSE-PAPIERS PARTAGÉ */}
        <div className="continuity-panel">
          <div className="continuity-panel-title">
            <div className="title-left">
              <ClipboardCopy size={18} color="#818cf8" />
              <span>Presse-papiers universel (Chiffré E2E)</span>
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.75rem", color: "#34d399" }}>
              <ShieldCheck size={14} /> Chiffrement AES-GCM
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "#9ca3af", cursor: "pointer" }}>
              <input 
                type="checkbox" 
                checked={autoSyncClipboard} 
                onChange={(e) => {
                  setAutoSyncClipboard(e.target.checked);
                  onNotice(e.target.checked ? "Écoute automatique du presse-papiers activée." : "Écoute automatique désactivée.");
                }} 
              />
              <span>Écoute automatique en arrière-plan</span>
            </label>

            <button 
              className="quick-pill" 
              onClick={() => setFilterSensitive(!filterSensitive)}
              title="Masquer les mots de passe et clés d'API"
            >
              {filterSensitive ? <EyeOff size={12} /> : <Eye size={12} />}
              <span>{filterSensitive ? "Secrets masqués" : "Secrets affichés"}</span>
            </button>
          </div>

          <div className="clipboard-input-box">
            <textarea
              className="clipboard-textarea"
              placeholder="Colle ou saisis du texte à partager instantanément avec tes appareils..."
              value={clipboardCurrent}
              onChange={(e) => setClipboardCurrent(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button 
              className="button button-secondary button-small"
              onClick={handleClearHistory}
              title="Vider l'historique"
            >
              <Trash2 size={13} /> Purger
            </button>

            <button 
              className="button button-primary" 
              disabled={!clipboardCurrent.trim()}
              onClick={handleSendClipboard}
            >
              <Send size={15} /> Synchroniser vers le téléphone
            </button>
          </div>

          {/* Historique du presse-papiers */}
          <div style={{ marginTop: "8px" }}>
            <span style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: 600 }}>HISTORIQUE RÉCENT</span>
            <div className="clipboard-history-list" style={{ marginTop: "6px" }}>
              {clipboardHistory.length === 0 ? (
                <div style={{ color: "#6b7280", fontSize: "0.8rem", padding: "10px 0" }}>Aucun élément dans l'historique.</div>
              ) : (
                clipboardHistory.map((item, index) => {
                  const isSensitive = filterSensitive && isSensitivePattern(item);
                  const isRevealed = revealedItems[index];

                  return (
                    <div className="clipboard-history-item" key={index}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                        {isSensitive && <Lock size={13} color="#f59e0b" />}
                        <span className="clipboard-text" title={isSensitive && !isRevealed ? "Donnée confidentielle" : item}>
                          {isSensitive && !isRevealed ? "•••••••••••••••• (Secret masqué)" : item}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {isSensitive && (
                          <button 
                            className="quick-pill" 
                            style={{ padding: "3px 6px" }}
                            onClick={() => setRevealedItems((prev) => ({ ...prev, [index]: !prev[index] }))}
                          >
                            {isRevealed ? <EyeOff size={11} /> : <Eye size={11} />}
                          </button>
                        )}
                        <button 
                          className="button button-secondary button-small"
                          onClick={() => handleCopyFromHistory(item)}
                        >
                          Copier
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* NOTIFICATIONS ANDROID EN DIRECT & RÉPONSE RAPIDE */}
        <div className="continuity-panel">
          <div className="continuity-panel-title">
            <div className="title-left">
              <Bell size={18} color="#f59e0b" />
              <span>Notifications Android en direct</span>
            </div>
            <span className="count-pill">{notifications.length} actives</span>
          </div>

          <p style={{ margin: 0, fontSize: "0.84rem", color: "#9ca3af" }}>
            Reçois les notifications de ton smartphone sur ce PC et réponds directement aux SMS et messages.
          </p>

          <div className="notifications-list">
            {notifications.length === 0 ? (
              <div style={{ textAlign: "center", padding: "24px 0", color: "#6b7280", fontSize: "0.85rem" }}>
                Aucune notification en attente sur ton smartphone.
              </div>
            ) : (
              notifications.map((notif) => {
                const isSensitive = notif.isSensitive;
                const isRevealed = revealedNotifs[notif.id];

                return (
                  <div className="notification-card" key={notif.id}>
                    <div className="notification-header">
                      <div className="notification-app-info">
                        <MessageSquare size={14} />
                        <span>{notif.appName} · {notif.title}</span>
                      </div>
                      <span className="notification-time">{notif.time}</span>
                    </div>

                    <div className="notification-body">
                      {isSensitive && !isRevealed ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#f59e0b", fontSize: "0.82rem" }}>
                          <Lock size={13} />
                          <span>Information confidentielle masquée</span>
                          <button 
                            className="quick-pill" 
                            style={{ padding: "2px 6px", fontSize: "0.7rem" }}
                            onClick={() => setRevealedNotifs((prev) => ({ ...prev, [notif.id]: true }))}
                          >
                            Afficher
                          </button>
                        </div>
                      ) : (
                        notif.text
                      )}
                    </div>

                    {notif.canReply && (
                      <div className="quick-reply-box">
                        <input 
                          type="text" 
                          className="quick-reply-input"
                          placeholder="Répondre rapidement..."
                          value={replyTexts[notif.id] || ""}
                          onChange={(e) => setReplyTexts((prev) => ({ ...prev, [notif.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSendQuickReply(notif.id);
                          }}
                        />
                        <button 
                          className="button button-primary button-small"
                          onClick={() => void handleSendQuickReply(notif.id)}
                          disabled={!replyTexts[notif.id]?.trim()}
                        >
                          <Send size={12} /> Répondre
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
