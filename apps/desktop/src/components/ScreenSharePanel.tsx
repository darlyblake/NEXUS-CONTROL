import { useEffect, useRef, useState } from "react";
import "./screen-share.css";
import { Monitor, Pause, Play, ShieldCheck } from "lucide-react";

type ScreenSharePanelProps = {
  socket: WebSocket | null;
  connected: boolean;
  onNotice?: (message: string) => void;
};

/**
 * Consent-first viewer for the Windows session screen-share protocol.
 * The Windows session companion must explicitly acknowledge start_screen_share
 * before this panel displays frames. Binary WebSocket messages are JPEG frames.
 */
export function ScreenSharePanel({ socket, connected, onNotice }: ScreenSharePanelProps) {
  const screenShareTransportReady = false; // Relay/companion JPEG transport is not implemented in this branch.
  const [sharing, setSharing] = useState(false);
  const [width, setWidth] = useState("1280");
  const [height, setHeight] = useState("720");
  const [fps, setFps] = useState("5");
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [lastFrameAt, setLastFrameAt] = useState<number | null>(null);
  const pendingStart = useRef(false);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === "screen_share_started") {
          pendingStart.current = false;
          setSharing(true);
          onNotice?.("Le partage d’écran Windows est actif.");
        } else if (message.type === "screen_share_stopped") {
          pendingStart.current = false;
          setSharing(false);
          setFrameUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
          onNotice?.("Le partage d’écran est arrêté.");
        } else if (message.type === "screen_share_error") {
          pendingStart.current = false;
          setSharing(false);
          onNotice?.(typeof message.message === "string" ? message.message : "Le partage d’écran a échoué.");
        }
        return;
      }
      if (!(event.data instanceof Blob)) return;
      const nextUrl = URL.createObjectURL(event.data);
      setFrameUrl((old) => { if (old) URL.revokeObjectURL(old); return nextUrl; });
      setFrameCount((n) => n + 1);
      setLastFrameAt(Date.now());
    };
    socket.addEventListener("message", onMessage);
    return () => {
      socket.removeEventListener("message", onMessage);
    };
  }, [socket, onNotice]);

  useEffect(() => () => {
    if (frameUrl) URL.revokeObjectURL(frameUrl);
  }, [frameUrl]);

  const start = () => {
    if (!screenShareTransportReady || !connected || !socket || socket.readyState !== WebSocket.OPEN || pendingStart.current || sharing) return;
    pendingStart.current = true;
    socket.send(JSON.stringify({
      type: "command",
      action: "start_screen_share",
      commandId: crypto.randomUUID(),
      timestamp: Date.now(),
      settings: { width: Number(width), height: Number(height), fps: Number(fps), format: "jpeg" },
      requireLocalConsent: true
    }));
    onNotice?.("Demande envoyée. Confirme le partage sur la session Windows si demandé.");
  };

  const stop = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setSharing(false);
      return;
    }
    socket.send(JSON.stringify({
      type: "command",
      action: "stop_screen_share",
      commandId: crypto.randomUUID(),
      timestamp: Date.now()
    }));
    pendingStart.current = false;
    setSharing(false);
    setFrameUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    onNotice?.("Commande d’arrêt envoyée.");
  };

  return (
    <section className="panel screen-share-panel" aria-labelledby="screen-share-title">
      <div className="panel-heading">
        <div>
          <h2 id="screen-share-title"><Monitor size={18} /> Écran Windows en direct</h2>
          <p>Le partage doit être autorisé depuis la session Windows active.</p>
        </div>
        <span className={sharing ? "screen-share-state active" : "screen-share-state"}>
          <span />{sharing ? "Partage actif" : "À l’arrêt"}
        </span>
      </div>
      <div className="screen-share-consent">
        <ShieldCheck size={16} />
        <span>Le partage est visible et peut être interrompu immédiatement depuis Ubuntu ou Windows.</span>
      </div>
      <div className="screen-share-settings">
        <label>Résolution
          <select value={width + "x" + height} onChange={(e) => {
            const [w, h] = e.target.value.split("x"); setWidth(w); setHeight(h);
          }} disabled={sharing || pendingStart.current}>
            <option value="854x480">854 × 480</option>
            <option value="1280x720">1280 × 720</option>
            <option value="1600x900">1600 × 900</option>
            <option value="1920x1080">1920 × 1080</option>
          </select>
        </label>
        <label>Fréquence
          <select value={fps} onChange={(e) => setFps(e.target.value)} disabled={sharing || pendingStart.current}>
            <option value="1">1 image/s — économie</option>
            <option value="5">5 images/s</option>
            <option value="10">10 images/s</option>
            <option value="15">15 images/s — fluide</option>
          </select>
        </label>
        {!sharing ? (
          <button className="button button-primary" onClick={start} disabled={!connected || pendingStart.current}>
            <Play size={15} /> {pendingStart.current ? "Demande envoyée…" : "Démarrer le partage"}
          </button>
        ) : (
          <button className="button button-danger" onClick={stop}>
            <Pause size={15} /> Arrêter immédiatement
          </button>
        )}
      </div>
      <div className="screen-share-viewport" aria-live="polite">
        {frameUrl ? <img src={frameUrl} alt="Capture en direct de la session Windows partagée" /> :
          <div className="screen-share-empty"><Monitor size={34} /><strong>Aucun flux vidéo reçu</strong><span>Associe le PC Windows et démarre le partage pour afficher son écran ici.</span></div>}
      </div>
      <div className="screen-share-footer">
        <span>{connected ? "Relais connecté" : "Relais non connecté"}</span>
        <span>{frameCount} images reçues</span>
        <span>{lastFrameAt ? "Dernière image : " + new Date(lastFrameAt).toLocaleTimeString() : "En attente du flux"}</span>
      </div>
      <p className="screen-share-note">Le flux JPEG et son routage dans le relais ne sont pas encore implémentés. Le démarrage est désactivé pour éviter de fermer la connexion distante avec une commande non prise en charge. Tant que ce transport n’est pas ajouté et testé, aucune image d’écran ne sera reçue et la souris distante reste désactivée.</p>
    </section>
  );
}
