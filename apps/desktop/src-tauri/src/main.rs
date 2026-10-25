#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::process::Command;

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
        ("meshcentral", "MeshCentral CLI", "Commande MeshCentral disponible dans le PATH"),
        ("wg", "WireGuard", "Outils du réseau privé distant"),
    ];

    checks
        .iter()
        .map(|(id, label, detail)| LocalTool {
            id: (*id).to_string(),
            label: (*label).to_string(),
            installed: command_exists(id),
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

    // Revalidate the selected serial against the live ADB list before starting a viewer.
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_local_tools,
            scan_android_devices,
            launch_scrcpy
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de NEXUS CONTROL");
}
