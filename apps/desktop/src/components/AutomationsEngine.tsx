import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Play,
  Clock,
  Wifi,
  Moon,
  Lock,
  BellRing,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  Trash2,
  Sparkles,
  Zap,
  FolderSync,
} from "lucide-react";
import "./AutomationsEngine.css";

export interface AutomationRule {
  id: string;
  name: string;
  category: "backup" | "security" | "power" | "ring" | "custom";
  trigger: string;
  action: string;
  enabled: boolean;
  lastRun?: string;
}

export interface ExecutionLog {
  id: string;
  ruleName: string;
  timestamp: string;
  status: "success" | "warning" | "error";
  details: string;
}

interface AutomationExecutionResult {
  scenario_id: string;
  success: boolean;
  summary: string;
  details: string;
  files_transferred: number;
  bytes_transferred: number;
}

interface AutomationsEngineProps {
  runtime: boolean;
  onNotice: (msg: string) => void;
}

const DEFAULT_RULES: AutomationRule[] = [
  {
    id: "rule-backup-dcim",
    name: "Sauvegarde auto Photos (DCIM)",
    category: "backup",
    trigger: "Quand le téléphone rejoint le Wi-Fi domestique",
    action: "Synchroniser /sdcard/DCIM vers ~/Sauvegardes/Photos",
    enabled: true,
    lastRun: "Jamais exécuté",
  },
  {
    id: "rule-night-mode",
    name: "Scénario Mode Nuit / Départ",
    category: "power",
    trigger: "Tous les soirs ou sur demande en 1 clic",
    action: "Mettre en veille les PC distants et verrouiller les terminaux",
    enabled: true,
    lastRun: "Jamais exécuté",
  },
  {
    id: "rule-emergency-lock",
    name: "Verrouillage à distance d'urgence",
    category: "security",
    trigger: "Commande WSS authentifiée ou bouton d'alerte",
    action: "Verrouiller immédiatement l'écran PC et smartphone",
    enabled: true,
    lastRun: "Jamais exécuté",
  },
  {
    id: "rule-find-phone",
    name: "Faire sonner l'appareil égaré",
    category: "ring",
    trigger: "Bouton d'urgence ou déclencheur rapide",
    action: "Activer volume 100% et faire sonner/vibrer le smartphone",
    enabled: true,
    lastRun: "Jamais exécuté",
  },
];

export function AutomationsEngine({ runtime, onNotice }: AutomationsEngineProps) {
  const [rules, setRules] = useState<AutomationRule[]>(() => {
    try {
      const saved = localStorage.getItem("nexus.automations.rules");
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return DEFAULT_RULES;
  });

  const [logs, setLogs] = useState<ExecutionLog[]>(() => {
    try {
      const saved = localStorage.getItem("nexus.automations.logs");
      if (saved) return JSON.parse(saved);
    } catch {
      // fallback
    }
    return [
      {
        id: "log-init",
        ruleName: "Moteur d'automatisations initialisé",
        timestamp: "Initialisation",
        status: "success",
        details: "4 scénarios par défaut prêts à l'emploi.",
      },
    ];
  });

  const [executingId, setExecutingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [newRuleName, setNewRuleName] = useState("");
  const [newRuleCategory, setNewRuleCategory] = useState<AutomationRule["category"]>("backup");
  const [newRuleTrigger, setNewRuleTrigger] = useState("");
  const [newRuleAction, setNewRuleAction] = useState("");

  // Sauvegarde persistante des règles
  useEffect(() => {
    try {
      localStorage.setItem("nexus.automations.rules", JSON.stringify(rules));
    } catch {
      // ignore
    }
  }, [rules]);

  // Sauvegarde persistante des logs
  useEffect(() => {
    try {
      localStorage.setItem("nexus.automations.logs", JSON.stringify(logs));
    } catch {
      // ignore
    }
  }, [logs]);

  const handleToggleRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id === ruleId) {
          const next = !r.enabled;
          onNotice(`Règle « ${r.name} » ${next ? "activée" : "désactivée"}.`);
          return { ...r, enabled: next };
        }
        return r;
      })
    );
  };

  const handleRunNow = async (rule: AutomationRule) => {
    setExecutingId(rule.id);
    onNotice(`Exécution du scénario : ${rule.name}...`);

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    try {
      let result: AutomationExecutionResult;
      if (runtime) {
        result = await invoke<AutomationExecutionResult>("run_automation_scenario", {
          scenarioId: rule.id,
          params: null,
        });
      } else {
        // Mode web de démonstration
        await new Promise((r) => setTimeout(r, 800));
        result = {
          scenario_id: rule.id,
          success: true,
          summary: "Simulation web réussie",
          details: `Action exécutée en mode web : ${rule.action}`,
          files_transferred: 0,
          bytes_transferred: 0,
        };
      }

      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, lastRun: `Aujourd'hui à ${timeStr}` } : r))
      );

      setLogs((prev) => [
        {
          id: "log-" + Date.now(),
          ruleName: rule.name,
          timestamp: `Aujourd'hui à ${timeStr}`,
          status: result.success ? "success" : "warning",
          details: `${result.summary} — ${result.details}`,
        },
        ...prev,
      ]);

      if (result.success) {
        onNotice(`Scénario « ${rule.name} » : ${result.summary}`);
      } else {
        onNotice(`Avertissement « ${rule.name} » : ${result.details}`);
      }
    } catch (err) {
      setLogs((prev) => [
        {
          id: "log-" + Date.now(),
          ruleName: rule.name,
          timestamp: `Aujourd'hui à ${timeStr}`,
          status: "error",
          details: `Erreur d'exécution : ${String(err)}`,
        },
        ...prev,
      ]);
      onNotice(`Erreur lors de l'exécution de « ${rule.name} » : ${String(err)}`);
    } finally {
      setExecutingId(null);
    }
  };

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRuleName.trim() || !newRuleAction.trim()) {
      onNotice("Veuillez renseigner le nom et l'action du scénario.");
      return;
    }

    const newRule: AutomationRule = {
      id: "rule-" + Date.now(),
      name: newRuleName.trim(),
      category: newRuleCategory,
      trigger: newRuleTrigger.trim() || "Déclenchement manuel ou planifié",
      action: newRuleAction.trim(),
      enabled: true,
      lastRun: "Jamais exécuté",
    };

    setRules((prev) => [...prev, newRule]);
    setShowModal(false);
    setNewRuleName("");
    setNewRuleTrigger("");
    setNewRuleAction("");
    onNotice(`Nouveau scénario « ${newRule.name} » ajouté !`);
  };

  const handleDeleteRule = (ruleId: string) => {
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    onNotice("Scénario supprimé.");
  };

  const handleClearLogs = () => {
    setLogs([]);
    onNotice("Journal d'exécution vidé.");
  };

  const getCategoryIcon = (category: AutomationRule["category"]) => {
    switch (category) {
      case "backup":
        return <UploadCloud size={18} />;
      case "security":
        return <Lock size={18} />;
      case "power":
        return <Moon size={18} />;
      case "ring":
        return <BellRing size={18} />;
      case "custom":
        return <Zap size={18} />;
    }
  };

  return (
    <div className="automations-container">
      {/* Hero Banner */}
      <div className="automations-hero">
        <div className="automations-hero-copy">
          <h2>Moteur d'Automatisations & Tâches d'Arrière-plan</h2>
          <p>
            Scénarios proactifs et réactifs exécutés en tâche de fond : synchronisation automatique des photos
            dès connexion Wi-Fi, mode départ/nuit en un clic, et verrouillage d'urgence.
          </p>
        </div>
        <button className="button button-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Créer un scénario personnalisé
        </button>
      </div>

      {/* Grille des scénarios */}
      <div className="scenarios-grid">
        {rules.map((rule) => (
          <div className={`scenario-card ${!rule.enabled ? "disabled" : ""}`} key={rule.id}>
            <div className="scenario-header">
              <div className="scenario-title-area">
                <div className={`scenario-icon-wrap ${rule.category}`}>
                  {getCategoryIcon(rule.category)}
                </div>
                <div>
                  <div className="scenario-name">{rule.name}</div>
                  <div className="scenario-trigger">
                    <Clock size={12} /> {rule.trigger}
                  </div>
                </div>
              </div>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => handleToggleRule(rule.id)}
                />
                <span className="slider"></span>
              </label>
            </div>

            <div className="scenario-description">{rule.action}</div>

            <div className="scenario-actions-row">
              <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                {rule.lastRun ? `Dernière exécution : ${rule.lastRun}` : "Jamais exécuté"}
              </span>

              <div style={{ display: "flex", gap: "6px" }}>
                {rule.category === "custom" && (
                  <button
                    className="button button-secondary button-small"
                    onClick={() => handleDeleteRule(rule.id)}
                    title="Supprimer ce scénario"
                  >
                    <Trash2 size={13} color="#ef4444" />
                  </button>
                )}
                <button
                  className="button button-secondary button-small"
                  disabled={executingId === rule.id || !rule.enabled}
                  onClick={() => handleRunNow(rule)}
                >
                  <Play size={13} /> {executingId === rule.id ? "En cours..." : "Exécuter"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal de création de scénario */}
      {showModal && (
        <div className="preview-modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="preview-modal"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="preview-modal-header">
              <h3>Créer un nouveau scénario</h3>
              <button
                className="button button-secondary button-small"
                onClick={() => setShowModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRule} style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#9ca3af", marginBottom: "4px" }}>
                  Nom du scénario
                </label>
                <input
                  className="remote-server-input"
                  style={{ width: "100%", margin: 0 }}
                  placeholder="Ex: Nettoyage fichiers temporaires"
                  value={newRuleName}
                  onChange={(e) => setNewRuleName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#9ca3af", marginBottom: "4px" }}>
                  Catégorie
                </label>
                <select
                  className="remote-server-input"
                  style={{ width: "100%", margin: 0 }}
                  value={newRuleCategory}
                  onChange={(e) => setNewRuleCategory(e.target.value as any)}
                >
                  <option value="backup">Sauvegarde & Synchronisation</option>
                  <option value="security">Sécurité & Verrouillage</option>
                  <option value="power">Alimentation & Veille</option>
                  <option value="ring">Signalisation & Alerte</option>
                  <option value="custom">Personnalisé</option>
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#9ca3af", marginBottom: "4px" }}>
                  Déclencheur (Quand...)
                </label>
                <input
                  className="remote-server-input"
                  style={{ width: "100%", margin: 0 }}
                  placeholder="Ex: Tous les lundis à 08h00 ou sur clic"
                  value={newRuleTrigger}
                  onChange={(e) => setNewRuleTrigger(e.target.value)}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", color: "#9ca3af", marginBottom: "4px" }}>
                  Action à exécuter (Faire...)
                </label>
                <textarea
                  className="remote-server-input"
                  style={{ width: "100%", margin: 0 }}
                  rows={3}
                  placeholder="Ex: Synchroniser le dossier Téléchargements vers le NAS distant"
                  value={newRuleAction}
                  onChange={(e) => setNewRuleAction(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "10px" }}>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setShowModal(false)}
                >
                  Annuler
                </button>
                <button type="submit" className="button button-primary">
                  <CheckCircle2 size={15} /> Enregistrer le scénario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Historique des exécutions */}
      <div className="panel" style={{ marginTop: "12px" }}>
        <div className="panel-header">
          <div>
            <h3>Journal d'Exécution des Tâches</h3>
            <p>Historique des actions déclenchées automatiquement ou manuellement.</p>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span className="count-pill">{logs.length} exécution(s)</span>
            {logs.length > 0 && (
              <button
                className="button button-secondary button-small"
                onClick={handleClearLogs}
                title="Vider le journal"
              >
                <Trash2 size={13} /> Vider
              </button>
            )}
          </div>
        </div>

        {logs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px", color: "var(--text-muted, #94a3b8)" }}>
            Aucun journal d'exécution enregistré.
          </div>
        ) : (
          <table className="execution-history-table">
            <thead>
              <tr>
                <th>SCÉNARIO</th>
                <th>HEURE</th>
                <th>STATUT</th>
                <th>RÉSULTAT / DÉTAILS</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>
                    <strong>{log.ruleName}</strong>
                  </td>
                  <td style={{ color: "#9ca3af", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
                    {log.timestamp}
                  </td>
                  <td>
                    {log.status === "success" && (
                      <span
                        className="state-pill state-ready"
                        style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                      >
                        <CheckCircle2 size={13} color="#10b981" /> Succès
                      </span>
                    )}
                    {log.status === "warning" && (
                      <span
                        className="state-pill"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "rgba(245, 158, 11, 0.15)",
                          color: "#fbbf24",
                          border: "1px solid rgba(245, 158, 11, 0.3)",
                        }}
                      >
                        <AlertTriangle size={13} color="#fbbf24" /> Attention
                      </span>
                    )}
                    {log.status === "error" && (
                      <span
                        className="state-pill"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          background: "rgba(239, 68, 68, 0.15)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                        }}
                      >
                        <XCircle size={13} color="#f87171" /> Erreur
                      </span>
                    )}
                  </td>
                  <td style={{ color: "#d1d5db" }}>{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
