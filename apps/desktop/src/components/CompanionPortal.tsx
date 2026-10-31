import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { QRCodeSVG } from 'qrcode.react';
import {
  Smartphone,
  QrCode,
  Cable,
  Wifi,
  Copy,
  Check,
  Zap,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Radio,
  FileUp,
  MonitorPlay,
  ClipboardCheck,
  ArrowRight
} from 'lucide-react';
import './CompanionPortal.css';

interface CompanionServerInfo {
  local_ip: string;
  port: number;
  token: string;
  pairing_url: string;
  expires_at: number;
}

interface UsbAutoConnectResult {
  success: boolean;
  device_serial: string;
  device_ip: string;
  wifi_connected: boolean;
  agent_installed: boolean;
  message: string;
  steps_completed: string[];
}

interface AndroidDevice {
  id: string;
  state: string;
  model: string;
}

interface CompanionPortalProps {
  onOpenScreenShare?: (deviceId: string) => void;
  onOpenFileExplorer?: () => void;
}

export const CompanionPortal: React.FC<CompanionPortalProps> = ({
  onOpenScreenShare,
  onOpenFileExplorer,
}) => {
  const [activeTab, setActiveTab] = useState<'cable' | 'wifi'>('cable');

  // État Câble USB
  const [usbDevices, setUsbDevices] = useState<AndroidDevice[]>([]);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  const [isScanningUsb, setIsScanningUsb] = useState(false);
  const [isAutoConnecting, setIsAutoConnecting] = useState(false);
  const [usbResult, setUsbResult] = useState<UsbAutoConnectResult | null>(null);
  const [progressTimer, setProgressTimer] = useState(0);

  // État Wi-Fi / QR Code
  const [serverInfo, setServerInfo] = useState<CompanionServerInfo | null>(null);
  const [isServerActive, setIsServerActive] = useState(false);
  const [serverLoading, setServerLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [timeLeft, setTimeLeft] = useState(300);

  // Scan initial des appareils USB
  useEffect(() => {
    scanUsbDevices();
  }, []);

  // Décompte pour le token d'appairage Wi-Fi
  useEffect(() => {
    let interval: any = null;
    if (isServerActive && serverInfo) {
      interval = setInterval(() => {
        const now = Math.floor(Date.now() / 1000);
        const rem = Math.max(0, serverInfo.expires_at - now);
        setTimeLeft(rem);
        if (rem === 0) {
          // Token expiré : redémarrer ou avertir
          handleStartServer();
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isServerActive, serverInfo]);

  // Timer visuel 15s lors de l'auto-connexion
  useEffect(() => {
    let timer: any = null;
    if (isAutoConnecting) {
      setProgressTimer(0);
      timer = setInterval(() => {
        setProgressTimer((prev) => (prev < 15 ? prev + 1 : prev));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isAutoConnecting]);

  const scanUsbDevices = async () => {
    setIsScanningUsb(true);
    try {
      const devices = await invoke<AndroidDevice[]>('scan_android_devices');
      setUsbDevices(devices || []);
      if (devices && devices.length > 0 && !selectedSerial) {
        setSelectedSerial(devices[0].id);
      }
    } catch (e) {
      console.error('Erreur scan USB:', e);
    } finally {
      setIsScanningUsb(false);
    }
  };

  const handleAutoConnectUsb = async () => {
    if (!selectedSerial) return;
    setIsAutoConnecting(true);
    setUsbResult(null);

    try {
      const res = await invoke<UsbAutoConnectResult>('auto_connect_usb_android', {
        serial: selectedSerial,
      });
      setUsbResult(res);
      // Rafraîchir la liste après configuration
      scanUsbDevices();
    } catch (err: any) {
      setUsbResult({
        success: false,
        device_serial: selectedSerial,
        device_ip: '',
        wifi_connected: false,
        agent_installed: false,
        message: `Erreur d'exécution: ${err?.toString() || 'Inconnue'}`,
        steps_completed: ['❌ Échec du processus automatique'],
      });
    } finally {
      setIsAutoConnecting(false);
    }
  };

  const handleStartServer = async () => {
    setServerLoading(true);
    try {
      const info = await invoke<CompanionServerInfo>('start_companion_server');
      setServerInfo(info);
      setIsServerActive(true);
      const now = Math.floor(Date.now() / 1000);
      setTimeLeft(Math.max(0, info.expires_at - now));
    } catch (e) {
      console.error('Erreur lancement serveur companion:', e);
    } finally {
      setServerLoading(false);
    }
  };

  const handleStopServer = async () => {
    try {
      await invoke('stop_companion_server');
      setIsServerActive(false);
      setServerInfo(null);
    } catch (e) {
      console.error('Erreur arrêt serveur:', e);
    }
  };

  const copyPairingUrl = () => {
    if (serverInfo) {
      navigator.clipboard.writeText(serverInfo.pairing_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="companion-portal-root">
      {/* En-tête */}
      <div className="companion-header">
        <div className="companion-title-area">
          <div className="companion-icon-wrapper">
            <Zap className="companion-main-icon" />
          </div>
          <div>
            <h1>Connexion Express & Portail Mobile</h1>
            <p>
              Connectez n'importe quel smartphone à NEXUS CONTROL en quelques secondes,
              soit par câble USB instantané, soit via Wi-Fi par QR Code / lien direct.
            </p>
          </div>
        </div>

        {/* Sélecteur de méthode */}
        <div className="companion-tabs">
          <button
            className={`companion-tab-btn ${activeTab === 'cable' ? 'active' : ''}`}
            onClick={() => setActiveTab('cable')}
          >
            <Cable size={18} />
            <span>Câble USB (15s Auto)</span>
            <span className="badge-tag">Recommandé</span>
          </button>
          <button
            className={`companion-tab-btn ${activeTab === 'wifi' ? 'active' : ''}`}
            onClick={() => setActiveTab('wifi')}
          >
            <QrCode size={18} />
            <span>Wi-Fi Direct (QR Code & Lien)</span>
            <span className="badge-tag live">Sans Câble</span>
          </button>
        </div>
      </div>

      {/* CONTENU ONGLET 1: CÂBLE USB AUTO 15s */}
      {activeTab === 'cable' && (
        <div className="companion-section-card">
          <div className="section-head">
            <div>
              <h2>⚡ Configuration Express par Câble (15 secondes)</h2>
              <p>
                Branchez votre téléphone en USB. NEXUS active automatiquement ADB sans fil,
                détecte l'adresse IP, déploie et installe l'agent, et bascule la connexion.
              </p>
            </div>
            <button
              className="refresh-btn"
              onClick={scanUsbDevices}
              disabled={isScanningUsb || isAutoConnecting}
            >
              <RefreshCw size={16} className={isScanningUsb ? 'spin' : ''} />
              Actualiser
            </button>
          </div>

          <div className="usb-flow-container">
            {/* Sélection de l'appareil branché */}
            <div className="device-selection-box">
              <label>Appareil USB Détecté :</label>
              {usbDevices.length === 0 ? (
                <div className="empty-usb-alert">
                  <Smartphone className="empty-icon" size={32} />
                  <div>
                    <strong>Aucun appareil USB détecté</strong>
                    <p>
                      1. Branchez votre téléphone Android au PC par câble USB.
                      <br />
                      2. Activez le <em>Débogage USB</em> dans les Options pour Développeurs.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="devices-list">
                  {usbDevices.map((dev) => (
                    <div
                      key={dev.id}
                      className={`device-radio-card ${selectedSerial === dev.id ? 'selected' : ''}`}
                      onClick={() => setSelectedSerial(dev.id)}
                    >
                      <Smartphone size={24} className="device-icon" />
                      <div className="device-meta">
                        <span className="device-name">{dev.model || 'Smartphone Android'}</span>
                        <span className="device-serial">Série : {dev.id} ({dev.state})</span>
                      </div>
                      {selectedSerial === dev.id && <Check className="check-icon" size={18} />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Bouton d'action 15s */}
            <div className="auto-connect-action">
              <button
                className="btn-launch-15s"
                disabled={!selectedSerial || isAutoConnecting}
                onClick={handleAutoConnectUsb}
              >
                {isAutoConnecting ? (
                  <>
                    <RefreshCw className="spin" size={20} />
                    <span>Configuration en cours ({progressTimer}s / 15s)...</span>
                  </>
                ) : (
                  <>
                    <Zap size={20} />
                    <span>⚡ Lancer la configuration automatique (15s)</span>
                  </>
                )}
              </button>
              <span className="hint-text">
                Active le mode sans fil, installe l'agent NEXUS et lance la surveillance.
              </span>
            </div>

            {/* Barre de progression si en cours */}
            {isAutoConnecting && (
              <div className="progress-banner">
                <div className="progress-labels">
                  <span>Séquence d'initialisation en cours...</span>
                  <span>{Math.min(100, Math.round((progressTimer / 15) * 100))}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.min(100, (progressTimer / 15) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Résultat et étapes complétées */}
            {usbResult && (
              <div className={`result-box ${usbResult.success ? 'success' : 'warning'}`}>
                <div className="result-header">
                  {usbResult.success ? (
                    <CheckCircle2 className="result-icon success" size={24} />
                  ) : (
                    <AlertTriangle className="result-icon warning" size={24} />
                  )}
                  <div>
                    <h3>{usbResult.message}</h3>
                    {usbResult.device_ip && (
                      <p>Adresse IP du téléphone : <strong>{usbResult.device_ip}:5555</strong></p>
                    )}
                  </div>
                </div>

                <div className="steps-log">
                  <h4>Journal d'exécution :</h4>
                  <ul>
                    {usbResult.steps_completed.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ul>
                </div>

                {usbResult.success && (
                  <div className="quick-actions-bar">
                    <button
                      className="btn-quick-action"
                      onClick={() => onOpenScreenShare?.(usbResult.device_ip || selectedSerial)}
                    >
                      <MonitorPlay size={16} />
                      Voir l'écran en direct
                    </button>
                    <button
                      className="btn-quick-action secondary"
                      onClick={() => onOpenFileExplorer?.()}
                    >
                      <FileUp size={16} />
                      Accéder aux fichiers
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONTENU ONGLET 2: WI-FI DIRECT / QR CODE */}
      {activeTab === 'wifi' && (
        <div className="companion-section-card">
          <div className="section-head">
            <div>
              <h2>📱 Portail Web Mobile & Appairage Wi-Fi Direct</h2>
              <p>
                Générez un QR Code ou un lien direct. En scannant ou ouvrant ce lien sur votre téléphone,
                le portail Web s'ouvre immédiatement dans le navigateur sans rien devoir installer au préalable.
              </p>
            </div>
            {isServerActive ? (
              <button className="btn-stop-server" onClick={handleStopServer}>
                Arrêter le portail
              </button>
            ) : (
              <button
                className="btn-start-server"
                onClick={handleStartServer}
                disabled={serverLoading}
              >
                {serverLoading ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Radio size={16} />
                )}
                Démarrer le Portail
              </button>
            )}
          </div>

          {!isServerActive ? (
            <div className="server-offline-banner">
              <QrCode size={48} className="qr-placeholder-icon" />
              <h3>Le portail d'appairage est inactif</h3>
              <p>
                Cliquez sur le bouton ci-dessus pour activer le serveur HTTP local (port 4242)
                et générer votre lien d'accès sécurisé avec token temporaire.
              </p>
              <button className="btn-start-server cta" onClick={handleStartServer}>
                <Zap size={18} />
                Générer mon QR Code d'appairage
              </button>
            </div>
          ) : (
            <div className="server-active-grid">
              {/* Colonne Gauche: QR Code & Lien */}
              <div className="qr-container-card">
                <div className="qr-code-wrapper">
                  {serverInfo && (
                    <QRCodeSVG
                      value={serverInfo.pairing_url}
                      size={200}
                      level="M"
                      includeMargin={true}
                      bgColor="#ffffff"
                      fgColor="#0f1117"
                    />
                  )}
                </div>

                <div className="countdown-box">
                  <div className="countdown-label">
                    <span>Validité du jeton de sécurité :</span>
                    <strong>{Math.floor(timeLeft / 60)}m {timeLeft % 60}s</strong>
                  </div>
                  <div className="countdown-bar-bg">
                    <div
                      className="countdown-bar-fill"
                      style={{ width: `${(timeLeft / 300) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Lien cliquable et bouton copier */}
                <div className="url-copy-row">
                  <input
                    type="text"
                    readOnly
                    value={serverInfo?.pairing_url || ''}
                    className="url-input"
                  />
                  <button className="copy-btn" onClick={copyPairingUrl}>
                    {copied ? <Check size={18} color="#10b981" /> : <Copy size={18} />}
                    {copied ? 'Copié !' : 'Copier'}
                  </button>
                </div>
              </div>

              {/* Colonne Droite: Instructions & Capacités */}
              <div className="features-guide-card">
                <h3>Fonctionnalités disponibles sur le smartphone :</h3>
                <div className="companion-features-list">
                  <div className="feature-item">
                    <FileUp size={20} className="f-icon" />
                    <div>
                      <strong>Transfert de photos et fichiers</strong>
                      <p>Envoyez photos, vidéos et documents directement dans le dossier NEXUS du PC.</p>
                    </div>
                  </div>

                  <div className="feature-item">
                    <MonitorPlay size={20} className="f-icon" />
                    <div>
                      <strong>Diffusion d'écran WebRTC</strong>
                      <p>Partagez l'écran du téléphone en direct sans application tierce.</p>
                    </div>
                  </div>

                  <div className="feature-item">
                    <ClipboardCheck size={20} className="f-icon" />
                    <div>
                      <strong>Presse-papiers instantané</strong>
                      <p>Collez des liens ou du texte depuis le téléphone vers le PC d'un simple toucher.</p>
                    </div>
                  </div>

                  <div className="feature-item highlight">
                    <ShieldCheck size={20} className="f-icon" />
                    <div>
                      <strong>Téléchargement Agent Android (APK)</strong>
                      <p>Lien direct 1 clic sur le portail pour installer l'agent NEXUS autonome.</p>
                    </div>
                  </div>
                </div>

                <div className="instructions-steps">
                  <h4>Procédure :</h4>
                  <ol>
                    <li>Vérifiez que votre téléphone est connecté au même réseau Wi-Fi.</li>
                    <li>Ouvrez l'appareil photo ou le navigateur de votre téléphone et scannez le QR Code.</li>
                    <li>Le portail mobile s'affiche immédiatement.</li>
                  </ol>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
