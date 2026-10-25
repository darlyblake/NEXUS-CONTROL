#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{fs, path::PathBuf, process::Command};

#[derive(Serialize)]
struct LocalTool {
    id: String,
    label: String,
    installed: bool,
    detail: String,
}

#[derive(Serialize)]
struct AndroidDevice {
    id: String,
    state: String,
    model: String,
}

fn command_exists(program: &str) -> bool {
    let finder = if cfg!(target_os = "windows") { "where.exe" } else { "which" };
    Command::new(finder)
        .arg(program)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn meshcentral_installed() -> bool {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
    };

    base.map(|path| path.join("nexus-control").join("meshcentral").join("node_modules").join("meshcentral").exists())
        .unwrap_or(false)
        || command_exists("meshcentral")
}

fn read_android_devices() -> Result<Vec<AndroidDevice>, String> {
    if !command_exists("adb") {
        return Ok(Vec::new());
    }

    let output = Command::new("adb")
        .arg("devices")
        .arg("-l")
        .output()
        .map_err(|error| format!("Impossible de lancer adb : {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut devices = Vec::new();

    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() || line.starts_with('*') {
            continue;
        }

        let mut parts = line.split_whitespace();
        let id = match parts.next() {
            Some(value) => value,
            None => continue,
        };
        let state = match parts.next() {
            Some(value) => value,
            None => continue,
        };
        let model = line
            .split_whitespace()
            .find_map(|part| part.strip_prefix("model:"))
            .unwrap_or("Android")
            .replace('_', " ");

        devices.push(AndroidDevice {
            id: id.to_string(),
            state: state.to_string(),
            model,
        });
    }

    Ok(devices)
}

#[tauri::command]
fn get_local_tools() -> Vec<LocalTool> {
    let checks = [
        ("adb", "Android Debug Bridge", "Détection des appareils Android autorisés"),
        ("scrcpy", "scrcpy", "Affichage et contrôle d'écran Android"),
        ("node", "Node.js", "Runtime utilisé par certains outils intégrés"),
        ("npm", "npm", "Installation des intégrations JavaScript"),
        ("meshcentral", "MeshCentral", "Paquet MeshCentral local ou commande disponible"),
        ("wg", "WireGuard", "Outils du réseau privé distant"),
    ];

    checks
        .iter()
        .map(|(id, label, detail)| LocalTool {
            id: (*id).to_string(),
            label: (*label).to_string(),
            installed: if *id == "meshcentral" { meshcentral_installed() } else { command_exists(id) },
            detail: (*detail).to_string(),
        })
        .collect()
}

#[tauri::command]
fn scan_android_devices() -> Result<Vec<AndroidDevice>, String> {
    read_android_devices()
}

#[tauri::command]
fn launch_scrcpy(serial: String) -> Result<(), String> {
    if serial.trim().is_empty() {
        return Err("Identifiant Android manquant.".to_string());
    }
    if !command_exists("scrcpy") {
        return Err("scrcpy n'est pas installé ou n'est pas disponible dans le PATH.".to_string());
    }

    let devices = read_android_devices()?;
    let is_authorized_and_online = devices
        .iter()
        .any(|device| device.id == serial && device.state == "device");

    if !is_authorized_and_online {
        return Err("Cet appareil n'est pas connecté ou n'a pas autorisé le débogage USB.".to_string());
    }

    Command::new("scrcpy")
        .arg("--serial")
        .arg(&serial)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Impossible de lancer scrcpy : {error}"))
}

#[tauri::command]
fn install_integration(integration_id: String) -> Result<String, String> {
    // Only known, versioned installer scripts are allowed. Never execute UI-provided commands.
    match integration_id.as_str() {
        "meshcentral" => install_meshcentral(),
        _ => Err(format!("Aucune installation automatique n'est définie pour : {integration_id}")),
    }
}

fn install_meshcentral() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    let (script_name, script_content) = (
        "nexus-install-meshcentral.ps1",
        include_str!("../../../../scripts/installers/meshcentral-windows.ps1"),
    );
    #[cfg(target_os = "linux")]
    let (script_name, script_content) = (
        "nexus-install-meshcentral.sh",
        include_str!("../../../../scripts/installers/meshcentral-linux.sh"),
    );
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    return Err("L'installation automatique de MeshCentral est actuellement prise en charge sur Windows et Linux.".to_string());

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        let script_path = std::env::temp_dir().join(script_name);
        fs::write(&script_path, script_content)
            .map_err(|error| format!("Impossible de préparer le script d'installation : {error}"))?;

        #[cfg(target_os = "windows")]
        {
            Command::new("powershell.exe")
                .arg("-NoProfile")
                .arg("-ExecutionPolicy")
                .arg("Bypass")
                .arg("-NoExit")
                .arg("-File")
                .arg(&script_path)
                .spawn()
                .map_err(|error| format!("Impossible d'ouvrir PowerShell pour l'installation : {error}"))?;
        }

        #[cfg(target_os = "linux")]
        {
            let wrapper = r#"bash "$1"; status=$?; echo; echo "Script terminé (code $status)."; read -r -p "Appuie sur Entrée pour fermer ce terminal..." _; exit "$status""#;
            let terminal = if command_exists("x-terminal-emulator") {
                "x-terminal-emulator"
            } else if command_exists("gnome-terminal") {
                "gnome-terminal"
            } else if command_exists("konsole") {
                "konsole"
            } else {
                return Err("Aucun terminal compatible détecté. Installe x-terminal-emulator ou lance le script scripts/installers/meshcentral-linux.sh manuellement.".to_string());
            };

            let mut command = Command::new(terminal);
            if terminal == "gnome-terminal" {
                command.arg("--");
            } else if terminal == "konsole" {
                command.arg("-e");
            } else {
                command.arg("-e");
            }
            command
                .arg("bash")
                .arg("-lc")
                .arg(wrapper)
                .arg("nexus-installer")
                .arg(&script_path)
                .spawn()
                .map_err(|error| format!("Impossible d'ouvrir le terminal d'installation : {error}"))?;
        }

        Ok("Le terminal d'installation MeshCentral a été ouvert. Suis les étapes et lis les éventuels messages d'erreur dans ce terminal.".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_local_tools,
            scan_android_devices,
            launch_scrcpy,
            install_integration
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de NEXUS CONTROL");
}
