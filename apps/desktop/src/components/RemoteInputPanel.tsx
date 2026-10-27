import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Keyboard, Monitor, MousePointer2, Pause, Play, ScrollText, ShieldCheck } from "lucide-react";
import "./remote-input.css";

type RemoteInputPanelProps = {
  socket: WebSocket | null;
  connected: boolean;
  onNotice?: (message: string) => void;
};

type InputMessage = {
  type?: string;
  action?: string;
  message?: string;
  controlId?: string;
  x?: number;
  y?: number;
};

/**
 * Consent-first remote input UI. The Windows interactive-session companion
 * must approve the request and return control_session_started before input is enabled.
 * This panel intentionally does not treat a request sent as an active session.
 */
export function RemoteInputPanel({ socket, connected, onNotice }: RemoteInputPanelProps) {
  const [requestPending, setRequestPending] = useState(false);
  const [active, setActive] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [text, setText] = useState("");
  const [lastAction, setLastAction] = useState("Aucune action envoyée.");
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const moveRef = useRef<{ x: number; y: number } | null>(null);
  const moveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        if (event.data instanceof Blob) {
          const nextUrl = URL.createObjectURL(event.data);
          setFrameUrl((old) => { if (old) URL.revokeObjectURL(old); return nextUrl; });
        }
        return;
      }
      let message: InputMessage;
      try { message = JSON.parse(event.data) as InputMessage; } catch { return; }
      if (message.type === "screen_share_stopped" || message.type === "screen_share_error") {
        setFrameUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
      }
      if (message.type === "control_session_pending") {
        setRequestPending(true);
        onNotice?.("Demande de contrôle envoyée. Une personne doit l’autoriser sur Windows.");
      } else if (message.type === "control_session_started") {
        setRequestPending(false);
        setActive(true);
        setSessionId(message.controlId || "");
        setLastAction("Session autorisée par Windows.");
        onNotice?.("Contrôle distant autorisé sur Windows. L’indicateur local doit rester visible.");
      } else if (message.type === "control_session_stopped") {
        setRequestPending(false);
        setActive(false);
        setSessionId("");
        setText("");
        setLastAction("Session de contrôle arrêtée.");
        onNotice?.("Le contrôle distant est arrêté.");
      } else if (message.type === "control_session_denied" || message.type === "control_session_error") {
        setRequestPending(false);
        setActive(false);
        setSessionId("");
        const reason = message.message || "Windows a refusé la demande de contrôle.";
        setLastAction(reason);
        onNotice?.(reason);
      }
    };
    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket, onNotice]);

  useEffect(() => () => {
    if (moveTimerRef.current !== null) window.clearTimeout(moveTimerRef.current);
    if (frameUrl) URL.revokeObjectURL(frameUrl);
  }, [frameUrl]);

  const send = (action: string, payload: Record<string, unknown> = {}) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !active || !sessionId) return false;
    socket.send(JSON.stringify({
      type: "command",
      action: "windows_remote_input",
      commandId: crypto.randomUUID(),
      timestamp: Date.now(),
      controlId: sessionId,
      input: { action, ...payload }
    }));
    setLastAction("Action envoyée : " + action);
    return true;
  };

  const requestControl = () => {
    if (!connected || !socket || socket.readyState !== WebSocket.OPEN || requestPending || active) return;
    setRequestPending(true);
    socket.send(JSON.stringify({
      type: "command",
      action: "windows_control_request",
      commandId: crypto.randomUUID(),
      timestamp: Date.now(),
      requireLocalConsent: true
    }));
    onNotice?.("Demande envoyée. Le contrôle ne sera activé qu’après approbation explicite sur le PC Windows.");
  };

  const stopControl = () => {
    if (socket && socket.readyState === WebSocket.OPEN && sessionId) {
      socket.send(JSON.stringify({
        type: "command",
        action: "windows_control_stop",
        commandId: crypto.randomUUID(),
        timestamp: Date.now(),
        controlId: sessionId
      }));
    }
    setActive(false);
    setRequestPending(false);
    setSessionId("");
    setText("");
    setLastAction("Arrêt demandé depuis Ubuntu.");
    onNotice?.("Demande d’arrêt envoyée. Le compagnon Windows doit également terminer la session.");
  };

  const sendPointer = (event: ReactPointerEvent<HTMLDivElement>, action: "move" | "click") => {
    const surface = surfaceRef.current;
    const image = imageRef.current;
    if (!active || !frameUrl || !surface || !image || !image.naturalWidth || !image.naturalHeight) return;
    const rect = surface.getBoundingClientRect();
    const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
    const shownWidth = image.naturalWidth * scale;
    const shownHeight = image.naturalHeight * scale;
    const offsetX = (rect.width - shownWidth) / 2;
    const offsetY = (rect.height - shownHeight) / 2;
    const localX = event.clientX - rect.left - offsetX;
    const localY = event.clientY - rect.top - offsetY;
    if (localX < 0 || localY < 0 || localX > shownWidth || localY > shownHeight) return;
    const x = localX / shownWidth;
    const y = localY / shownHeight;
    if (action === "click") {
      send("mouse_click", { x, y, button: "left" });
      return;
    }
    moveRef.current = { x, y };
    if (moveTimerRef.current !== null) return;
    moveTimerRef.current = window.setTimeout(() => {
      const point = moveRef.current;
      moveTimerRef.current = null;
      if (point) send("mouse_move", point);
    }, 35);
  };

  const submitText = () => {
    const value = text;
    if (!value || !send("keyboard_text", { text: value.slice(0, 2000) })) return;
    setText("");
  };

  return (
    <section className="panel remote-input-panel" aria-labelledby="remote-input-title">
      <div className="panel-heading">
        <div>
          <h2 id="remote-input-title"><MousePointer2 size={18} /> Souris et clavier à distance</h2>
          <p>Le contrôle nécessite une approbation visible sur le PC Windows à chaque session.</p>
        </div>
        <span className={active ? "remote-input-state active" : "remote-input-state"}>
          <span />{active ? "Contrôle actif" : requestPending ? "En attente d’autorisation" : "À l’arrêt"}
        </span>
      </div>
      <div className="remote-input-consent">
        <ShieldCheck size={17} />
        <span>Windows doit afficher une demande d’autorisation et un indicateur permanent. Aucun événement n’est envoyé avant l’accord local.</span>
      </div>
      <div className="remote-input-toolbar">
        {!active ? (
          <button className="button button-primary" onClick={requestControl} disabled={!connected || requestPending}>
            <Play size={15} />{requestPending ? "En attente de Windows…" : "Demander le contrôle"}
          </button>
        ) : (
          <button className="button button-danger" onClick={stopControl}><Pause size={15} /> Arrêter le contrôle</button>
        )}
        <span className="remote-input-hint">{connected ? "Agent Windows connecté" : "Agent Windows non connecté"}</span>
      </div>
      <div
        ref={surfaceRef}
        className={"remote-input-surface" + (active && frameUrl ? " enabled" : "")}
        role="application"
        aria-label="Écran Windows partagé et zone de contrôle souris"
        onPointerMove={(event) => sendPointer(event, "move")}
        onClick={(event) => sendPointer(event as unknown as ReactPointerEvent<HTMLDivElement>, "click")}
        onWheel={(event) => { if (active && frameUrl) { event.preventDefault(); send("mouse_scroll", { deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY) }); } }}
      >
        {frameUrl ? <img ref={imageRef} src={frameUrl} alt="Écran Windows partagé" draggable={false} /> : <div className="remote-input-empty"><Monitor size={30} /><strong>Flux écran non disponible</strong><span>La souris reste désactivée jusqu’à réception d’une image Windows. Démarre le partage d’écran dans le panneau ci-dessus.</span></div>}
        <div className="remote-input-overlay"><strong>{active ? (frameUrl ? "Contrôle autorisé" : "Contrôle autorisé — en attente de l’écran") : "Zone souris désactivée"}</strong></div>
      </div>
      <div className="remote-input-keyboard">
        <label htmlFor="remote-input-text"><Keyboard size={16} /> Saisie clavier</label>
        <textarea
          id="remote-input-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Saisis le texte à envoyer à Windows…"
          rows={3}
          maxLength={2000}
          disabled={!active}
        />
        <button className="button button-secondary" onClick={submitText} disabled={!active || !text.trim()}>
          <Keyboard size={15} /> Envoyer le texte
        </button>
      </div>
      <div className="remote-input-status"><ScrollText size={15} /><span>{lastAction}</span></div>
      <p className="remote-input-note">Le compagnon Windows et le routage de contrôle sont présents dans cette branche, mais le relais ne transporte pas encore le flux vidéo. La souris reste donc désactivée jusqu’à réception d’une vraie image ; la saisie de texte est disponible après approbation locale. Les builds et tests de bout en bout restent à valider.</p>
    </section>
  );
}
