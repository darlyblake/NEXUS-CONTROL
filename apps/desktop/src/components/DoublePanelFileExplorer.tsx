import React, { useState, useEffect } from "react";
import { 
  Folder, 
  File, 
  FileText, 
  Image as ImageIcon, 
  Video, 
  Music, 
  Archive, 
  ArrowRight, 
  ArrowLeft, 
  RefreshCw, 
  HardDrive, 
  Smartphone, 
  Home, 
  Download, 
  ChevronRight,
  UploadCloud,
  CheckCircle2,
  Eye,
  X
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import "./DoublePanelFileExplorer.css";

export interface FileItem {
  name: string;
  is_dir?: boolean;
  isDir?: boolean;
  size: number;
  modified?: string;
  file_type?: string;
  type?: "image" | "video" | "audio" | "archive" | "document" | "generic";
}

interface DoublePanelFileExplorerProps {
  runtime: boolean;
  selectedAndroidDevice?: string;
  androidDevices: Array<{ id: string; model: string; state: string }>;
  onNotice: (msg: string) => void;
}

export function DoublePanelFileExplorer({
  runtime,
  selectedAndroidDevice,
  androidDevices,
  onNotice,
}: DoublePanelFileExplorerProps) {
  // Panneau gauche : PC local
  const [localPath, setLocalPath] = useState("/home");
  const [localFiles, setLocalFiles] = useState<FileItem[]>([]);
  const [selectedLocalFile, setSelectedLocalFile] = useState<FileItem | null>(null);

  // Panneau droit : Appareil Android distant
  const [remotePath, setRemotePath] = useState("/sdcard");
  const [remoteFiles, setRemoteFiles] = useState<FileItem[]>([]);
  const [selectedRemoteFile, setSelectedRemoteFile] = useState<FileItem | null>(null);

  const [activeDevice, setActiveDevice] = useState<string>(
    selectedAndroidDevice || androidDevices.find((d) => d.state === "device")?.id || ""
  );

  const [isTransferring, setIsTransferring] = useState(false);
  const [transferProgress, setTransferProgress] = useState<{
    file: string;
    progress: number;
    direction: "push" | "pull";
  } | null>(null);

  // Aperçu direct de fichier (Section A3)
  const [previewFile, setPreviewFile] = useState<{
    name: string;
    source: "local" | "remote";
    path: string;
    type: string;
  } | null>(null);

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "--";
    if (bytes < 1024) return bytes + " o";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " Ko";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " Mo";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " Go";
  };

  const getFileIcon = (item: FileItem) => {
    const isDirectory = item.is_dir ?? item.isDir;
    if (isDirectory) return <Folder size={18} className="file-icon folder" />;
    const t = item.file_type || item.type;
    switch (t) {
      case "image":
        return <ImageIcon size={18} className="file-icon" />;
      case "video":
        return <Video size={18} className="file-icon" />;
      case "audio":
        return <Music size={18} className="file-icon" />;
      case "archive":
        return <Archive size={18} className="file-icon" />;
      case "document":
        return <FileText size={18} className="file-icon" />;
      default:
        return <File size={18} className="file-icon" />;
    }
  };

  // Chargement des fichiers locaux
  const fetchLocalFiles = async (targetPath: string) => {
    if (!runtime) {
      setLocalFiles([
        { name: "Téléchargements", isDir: true, size: 0, type: "generic" },
        { name: "Documents", isDir: true, size: 0, type: "generic" },
        { name: "Images", isDir: true, size: 0, type: "generic" },
        { name: "rapport_reunion.pdf", isDir: false, size: 2450000, type: "document" },
        { name: "archive-backup.zip", isDir: false, size: 45200000, type: "archive" },
      ]);
      return;
    }
    try {
      const items = await invoke<FileItem[]>("list_local_directory", { path: targetPath });
      setLocalFiles(items);
    } catch (err) {
      onNotice("Impossible de lister le dossier PC : " + String(err));
    }
  };

  // Chargement des fichiers Android distants
  const fetchRemoteFiles = async (serial: string, targetPath: string) => {
    if (!runtime || !serial) {
      setRemoteFiles([
        { name: "DCIM", isDir: true, size: 0, type: "generic" },
        { name: "Download", isDir: true, size: 0, type: "generic" },
        { name: "Pictures", isDir: true, size: 0, type: "generic" },
        { name: "Documents", isDir: true, size: 0, type: "generic" },
        { name: "WhatsApp", isDir: true, size: 0, type: "generic" },
        { name: "photo_001.jpg", isDir: false, size: 4200000, type: "image" },
      ]);
      return;
    }
    try {
      const items = await invoke<FileItem[]>("adb_list_directory", { serial, remotePath: targetPath });
      setRemoteFiles(items);
    } catch (err) {
      onNotice("Impossible de lister les fichiers Android : " + String(err));
    }
  };

  useEffect(() => {
    void fetchLocalFiles(localPath);
  }, [localPath, runtime]);

  useEffect(() => {
    if (activeDevice) {
      void fetchRemoteFiles(activeDevice, remotePath);
    }
  }, [activeDevice, remotePath, runtime]);

  const handleOpenLocal = (item: FileItem) => {
    const isDirectory = item.is_dir ?? item.isDir;
    if (isDirectory) {
      const nextPath = localPath.endsWith("/") ? `${localPath}${item.name}` : `${localPath}/${item.name}`;
      setLocalPath(nextPath);
      setSelectedLocalFile(null);
    } else {
      setSelectedLocalFile(item);
    }
  };

  const handleOpenRemote = (item: FileItem) => {
    const isDirectory = item.is_dir ?? item.isDir;
    if (isDirectory) {
      const nextPath = remotePath.endsWith("/") ? `${remotePath}${item.name}` : `${remotePath}/${item.name}`;
      setRemotePath(nextPath);
      setSelectedRemoteFile(null);
    } else {
      setSelectedRemoteFile(item);
    }
  };

  const handleTransferToAndroid = async () => {
    if (!selectedLocalFile) {
      onNotice("Sélectionne d'abord un fichier sur le PC.");
      return;
    }
    const fullSource = localPath.endsWith("/") ? `${localPath}${selectedLocalFile.name}` : `${localPath}/${selectedLocalFile.name}`;
    const destination = remotePath.endsWith("/") ? `${remotePath}${selectedLocalFile.name}` : `${remotePath}/${selectedLocalFile.name}`;

    setIsTransferring(true);
    setTransferProgress({ file: selectedLocalFile.name, progress: 30, direction: "push" });

    try {
      if (runtime && activeDevice) {
        await invoke("adb_push_file", {
          serial: activeDevice,
          localPath: fullSource,
          remotePath: destination,
        });
        setTransferProgress({ file: selectedLocalFile.name, progress: 100, direction: "push" });
        onNotice(`Fichier envoyé sur Android : ${selectedLocalFile.name}`);
        void fetchRemoteFiles(activeDevice, remotePath);
      } else {
        await new Promise((r) => setTimeout(r, 600));
        setTransferProgress({ file: selectedLocalFile.name, progress: 100, direction: "push" });
        setRemoteFiles((prev) => [...prev, { ...selectedLocalFile }]);
        onNotice(`Fichier transféré vers Android : ${selectedLocalFile.name}`);
      }
    } catch (err) {
      onNotice("Échec du transfert vers Android : " + String(err));
    } finally {
      setTimeout(() => {
        setIsTransferring(false);
        setTransferProgress(null);
      }, 1000);
    }
  };

  const handleTransferToPc = async () => {
    if (!selectedRemoteFile) {
      onNotice("Sélectionne d'abord un fichier sur l'appareil distant.");
      return;
    }
    const fullRemoteSource = remotePath.endsWith("/") ? `${remotePath}${selectedRemoteFile.name}` : `${remotePath}/${selectedRemoteFile.name}`;
    const localDest = localPath.endsWith("/") ? `${localPath}${selectedRemoteFile.name}` : `${localPath}/${selectedRemoteFile.name}`;

    setIsTransferring(true);
    setTransferProgress({ file: selectedRemoteFile.name, progress: 40, direction: "pull" });

    try {
      if (runtime && activeDevice) {
        await invoke("adb_pull_file", {
          serial: activeDevice,
          remotePath: fullRemoteSource,
          localPath: localDest,
        });
        setTransferProgress({ file: selectedRemoteFile.name, progress: 100, direction: "pull" });
        onNotice(`Fichier récupéré sur le PC : ${selectedRemoteFile.name}`);
        void fetchLocalFiles(localPath);
      } else {
        await new Promise((r) => setTimeout(r, 600));
        setTransferProgress({ file: selectedRemoteFile.name, progress: 100, direction: "pull" });
        setLocalFiles((prev) => [...prev, { ...selectedRemoteFile }]);
        onNotice(`Fichier récupéré avec succès dans le dossier PC : ${selectedRemoteFile.name}`);
      }
    } catch (err) {
      onNotice("Échec de la récupération depuis l'appareil : " + String(err));
    } finally {
      setTimeout(() => {
        setIsTransferring(false);
        setTransferProgress(null);
      }, 1000);
    }
  };

  return (
    <div className="dual-explorer-container">
      {/* Barre d'action et sélecteur d'appareil */}
      <div className="panel" style={{ padding: "12px 18px", marginBottom: "0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "0.9rem", color: "#9ca3af", display: "flex", alignItems: "center", gap: "6px" }}>
              <Smartphone size={16} /> Appareil distant connecté :
            </span>
            <select 
              value={activeDevice} 
              onChange={(e) => setActiveDevice(e.target.value)}
              className="explorer-path-input"
              style={{ width: "auto", minWidth: "220px" }}
            >
              {androidDevices.filter((d) => d.state === "device").map((d) => (
                <option key={d.id} value={d.id}>
                  {d.model || "Appareil Android"} ({d.id})
                </option>
              ))}
              {androidDevices.filter((d) => d.state === "device").length === 0 && (
                <option value="">Aucun appareil USB/ADB connecté</option>
              )}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button 
              className="quick-pill" 
              onClick={() => {
                void fetchLocalFiles(localPath);
                if (activeDevice) void fetchRemoteFiles(activeDevice, remotePath);
                onNotice("Explorateur actualisé.");
              }}
            >
              <RefreshCw size={13} /> Actualiser
            </button>
          </div>
        </div>
      </div>

      {/* Grille Double Panneau */}
      <div className="dual-explorer-grid">
        {/* PANNEAU GAUCHE : PC LOCAL */}
        <div 
          className="explorer-panel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (selectedRemoteFile) void handleTransferToPc();
          }}
        >
          <div className="explorer-panel-header">
            <div className="explorer-title">
              <HardDrive size={18} color="#60a5fa" />
              <span>Ce PC (Local)</span>
            </div>
            <span className="count-pill">{localFiles.length} éléments</span>
          </div>

          <div className="explorer-nav-bar">
            <button 
              className="quick-pill" 
              title="Dossier parent"
              onClick={() => {
                const parts = localPath.split("/").filter(Boolean);
                parts.pop();
                setLocalPath("/" + parts.join("/"));
              }}
            >
              ← Retour
            </button>
            <input 
              type="text" 
              className="explorer-path-input" 
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchLocalFiles(localPath);
              }}
            />
          </div>

          <div className="explorer-quick-nav">
            <button className="quick-pill" onClick={() => setLocalPath("/home")}>
              <Home size={12} /> Dossier personnel
            </button>
            <button className="quick-pill" onClick={() => setLocalPath("/home/Téléchargements")}>
              <Download size={12} /> Téléchargements
            </button>
            <button className="quick-pill" onClick={() => setLocalPath("/home/Documents")}>
              Documents
            </button>
            <button className="quick-pill" onClick={() => setLocalPath("/home/Images")}>
              Images
            </button>
          </div>

          <ul className="explorer-file-list">
            {localFiles.map((item) => {
              const isDirectory = item.is_dir ?? item.isDir;
              return (
                <li
                  key={item.name}
                  draggable={!isDirectory}
                  onDragStart={() => setSelectedLocalFile(item)}
                  className={`explorer-file-item ${selectedLocalFile?.name === item.name ? "selected" : ""}`}
                  onClick={() => handleOpenLocal(item)}
                >
                  <div className="file-info-main">
                    {getFileIcon(item)}
                    <span className="file-name">{item.name}</span>
                  </div>
                  <div className="file-meta">
                    <span className="file-size">{formatSize(item.size)}</span>
                    {!isDirectory && (
                      <button 
                        className="quick-pill" 
                        style={{ padding: "2px 6px" }}
                        title="Aperçu direct"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewFile({
                            name: item.name,
                            source: "local",
                            path: `${localPath}/${item.name}`,
                            type: item.file_type || item.type || "generic"
                          });
                        }}
                      >
                        <Eye size={12} />
                      </button>
                    )}
                    {isDirectory && <ChevronRight size={14} color="#6b7280" />}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="explorer-footer">
            <span>Sélection : {selectedLocalFile ? selectedLocalFile.name : "Aucun fichier"}</span>
            <span>{selectedLocalFile ? formatSize(selectedLocalFile.size) : ""}</span>
          </div>
        </div>

        {/* PANNEAU DROIT : APPAREIL DISTANT */}
        <div 
          className="explorer-panel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (selectedLocalFile) void handleTransferToAndroid();
          }}
        >
          <div className="explorer-panel-header">
            <div className="explorer-title">
              <Smartphone size={18} color="#34d399" />
              <span>Appareil Distant (Android)</span>
            </div>
            <span className="count-pill">{remoteFiles.length} éléments</span>
          </div>

          <div className="explorer-nav-bar">
            <button 
              className="quick-pill" 
              title="Dossier parent"
              onClick={() => {
                const parts = remotePath.split("/").filter(Boolean);
                parts.pop();
                setRemotePath("/" + parts.join("/"));
              }}
            >
              ← Retour
            </button>
            <input 
              type="text" 
              className="explorer-path-input" 
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && activeDevice) void fetchRemoteFiles(activeDevice, remotePath);
              }}
            />
          </div>

          <div className="explorer-quick-nav">
            <button className="quick-pill" onClick={() => setRemotePath("/sdcard")}>
              <HardDrive size={12} /> Stockage interne
            </button>
            <button className="quick-pill" onClick={() => setRemotePath("/sdcard/DCIM")}>
              Photos (DCIM)
            </button>
            <button className="quick-pill" onClick={() => setRemotePath("/sdcard/Download")}>
              <Download size={12} /> Téléchargements
            </button>
            <button className="quick-pill" onClick={() => setRemotePath("/sdcard/Pictures")}>
              Images
            </button>
          </div>

          <ul className="explorer-file-list">
            {remoteFiles.map((item) => {
              const isDirectory = item.is_dir ?? item.isDir;
              return (
                <li
                  key={item.name}
                  draggable={!isDirectory}
                  onDragStart={() => setSelectedRemoteFile(item)}
                  className={`explorer-file-item ${selectedRemoteFile?.name === item.name ? "selected" : ""}`}
                  onClick={() => handleOpenRemote(item)}
                >
                  <div className="file-info-main">
                    {getFileIcon(item)}
                    <span className="file-name">{item.name}</span>
                  </div>
                  <div className="file-meta">
                    <span className="file-size">{formatSize(item.size)}</span>
                    {!isDirectory && (
                      <button 
                        className="quick-pill" 
                        style={{ padding: "2px 6px" }}
                        title="Aperçu direct"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewFile({
                            name: item.name,
                            source: "remote",
                            path: `${remotePath}/${item.name}`,
                            type: item.file_type || item.type || "generic"
                          });
                        }}
                      >
                        <Eye size={12} />
                      </button>
                    )}
                    {isDirectory && <ChevronRight size={14} color="#6b7280" />}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="explorer-footer">
            <span>Sélection : {selectedRemoteFile ? selectedRemoteFile.name : "Aucun fichier"}</span>
            <span>{selectedRemoteFile ? formatSize(selectedRemoteFile.size) : ""}</span>
          </div>
        </div>
      </div>

      {/* Barre d'actions de transfert */}
      <div className="explorer-actions-bar">
        <button
          className="transfer-button primary"
          disabled={!selectedLocalFile || isTransferring}
          onClick={handleTransferToAndroid}
        >
          <UploadCloud size={17} />
          <span>Envoyer vers l'appareil →</span>
        </button>

        <button
          className="transfer-button secondary"
          disabled={!selectedRemoteFile || isTransferring}
          onClick={handleTransferToPc}
        >
          <ArrowLeft size={17} />
          <span>← Récupérer sur le PC</span>
        </button>
      </div>

      {/* Carte d'état de transfert */}
      {transferProgress && (
        <div className="transfer-progress-card">
          <div className="progress-info">
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#fff" }}>
              {transferProgress.direction === "push" ? "Envoi vers l'appareil..." : "Téléchargement vers le PC..."}
            </span>
            <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
              {transferProgress.file} ({transferProgress.progress}%)
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div className="progress-bar-wrap">
              <div 
                className="progress-bar-fill" 
                style={{ width: `${transferProgress.progress}%` }}
              />
            </div>
            {transferProgress.progress === 100 && (
              <CheckCircle2 size={18} color="#10b981" />
            )}
          </div>
        </div>
      )}

      {/* Modal d'Aperçu Direct de Fichier (Section A3) */}
      {previewFile && (
        <div 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "20px"
          }}
          onClick={() => setPreviewFile(null)}
        >
          <div 
            style={{
              background: "#181922",
              border: "1px solid #323547",
              borderRadius: "12px",
              width: "100%",
              maxWidth: "540px",
              padding: "20px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
              display: "flex",
              flexDirection: "column",
              gap: "14px"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #272836", paddingBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#fff", fontWeight: 600 }}>
                <Eye size={18} color="#818cf8" />
                <span>Aperçu direct : {previewFile.name}</span>
              </div>
              <button 
                style={{ background: "transparent", border: "none", color: "#9ca3af", cursor: "pointer" }}
                onClick={() => setPreviewFile(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ minHeight: "180px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#111218", borderRadius: "8px", padding: "16px", color: "#d1d5db", textAlign: "center" }}>
              {previewFile.type === "image" ? (
                <div>
                  <ImageIcon size={48} color="#818cf8" style={{ marginBottom: "10px" }} />
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>Aperçu d'image : {previewFile.name}</p>
                  <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>{previewFile.path}</span>
                </div>
              ) : (
                <div>
                  <FileText size={48} color="#34d399" style={{ marginBottom: "10px" }} />
                  <p style={{ margin: 0, fontSize: "0.9rem" }}>Document {previewFile.type.toUpperCase()}</p>
                  <span style={{ fontSize: "0.78rem", color: "#6b7280" }}>Chemin : {previewFile.path}</span>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button className="button button-secondary" onClick={() => setPreviewFile(null)}>Fermer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
