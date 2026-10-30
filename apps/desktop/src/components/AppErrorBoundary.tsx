import React, { Component, type ErrorInfo, type ReactNode } from "react";

type State = { failed: boolean; message: string };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    return {
      failed: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("NEXUS CONTROL UI error:", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#f5f8fc", color: "#172b4d", fontFamily: "system-ui, sans-serif" }}>
          <section style={{ width: "min(560px, 100%)", padding: 28, border: "1px solid #d7e0ec", borderRadius: 14, background: "#fff" }}>
            <h1 style={{ marginTop: 0 }}>Une erreur a interrompu l’interface</h1>
            <p>NEXUS CONTROL a rencontré une erreur d’affichage. Le reste de l’application n’a pas été volontairement fermé.</p>
            <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", padding: 12, background: "#f1f4f8", borderRadius: 8 }}>{this.state.message}</pre>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 16px", border: 0, borderRadius: 8, background: "#2457a7", color: "#fff", cursor: "pointer" }}>Recharger l’interface</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
