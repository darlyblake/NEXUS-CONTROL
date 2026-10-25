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


#[derive(Serialize)]
struct NetworkDevice {
    ip: String,
    hostname: String,
    mac: String,
    kind: String,
}

fn local_ipv4() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("ip").args(["-o", "-f", "inet", "addr", "show", "scope", "global"])
            .output().map_err(|error| format!("Impossible de lire les interfaces réseau : {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(index) = parts.iter().position(|part| *part == "inet") {
                if let Some(cidr) = parts.get(index + 1) {
                    let ip = cidr.split('/').next().unwrap_or("");
                    if ip.parse::<std::net::Ipv4Addr>().is_ok() && !ip.starts_with("127.") && !ip.starts_with("169.254.") {
                        return Ok(ip.to_string());
                    }
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("ipconfig").output()
            .map_err(|error| format!("Impossible de lire les interfaces réseau : {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.to_lowercase().contains("ipv4") {
                if let Some(value) = line.split(':').last() {
                    let ip = value.trim().trim_start_matches("Preferred").trim();
                    if ip.parse::<std::net::Ipv4Addr>().is_ok() && !ip.starts_with("127.") && !ip.starts_with("169.254.") {
                        return Ok(ip.to_string());
                    }
                }
            }
        }
    }
    Err("Aucune adresse IPv4 locale détectée. Connecte cet ordinateur au Wi-Fi ou au réseau Ethernet, puis réessaie.".to_string())
}

fn ping_host(ip: &str) -> bool {
    #[cfg(target_os = "windows")]
    let result = Command::new("ping").args(["-n", "1", "-w", "300", ip]).output();
    #[cfg(not(target_os = "windows"))]
    let result = Command::new("ping").args(["-c", "1", "-W", "1", ip]).output();
    result.map(|output| output.status.success()).unwrap_or(false)
}

fn network_mac(ip: &str) -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("ip").args(["neigh", "show", ip]).output() {
            let line = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(index) = parts.iter().position(|part| *part == "lladdr") {
                if let Some(mac) = parts.get(index + 1) { return mac.to_string(); }
            }
        }
    }
    let output = Command::new("arp").arg("-a").output();
    if let Ok(output) = output {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if line.contains(ip) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(mac) = parts.iter().find(|part| part.matches(':').count() == 5 || part.matches('-').count() == 5) {
                    return mac.to_string();
                }
            }
        }
    }
    String::new()
}

fn network_hostname(ip: &str) -> String {
    #[cfg(target_os = "linux")]
    {
        if let Ok(output) = Command::new("getent").args(["hosts", ip]).output() {
            let line = String::from_utf8_lossy(&output.stdout);
            if let Some(name) = line.split_whitespace().nth(1) { return name.to_string(); }
        }
    }
    String::new()
}

#[tauri::command]
fn scan_network_devices() -> Result<Vec<NetworkDevice>, String> {
    let local_ip = local_ipv4()?;
    let octets: Vec<&str> = local_ip.split('.').collect();
    if octets.len() != 4 {
        return Err("Adresse IPv4 locale invalide.".to_string());
    }
    // Scan volontairement limité au /24 local, sans balayage d'autres réseaux.
    let prefix = format!("{}.{}.{}", octets[0], octets[1], octets[2]);
    let targets: Vec<String> = (1..=254)
        .map(|last| format!("{prefix}.{last}"))
        .filter(|ip| ip != &local_ip)
        .collect();
    let next = std::sync::atomic::AtomicUsize::new(0);
    let alive = std::sync::Mutex::new(Vec::<String>::new());

    std::thread::scope(|scope| {
        for _ in 0..24 {
            let targets = &targets;
            let next = &next;
            let alive = &alive;
            scope.spawn(move || loop {
                let index = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if index >= targets.len() { break; }
                let ip = &targets[index];
                if ping_host(ip) {
                    if let Ok(mut found) = alive.lock() { found.push(ip.clone()); }
                }
            });
        }
    });

    let mut ips = alive.into_inner().unwrap_or_default();
    ips.sort();
    ips.dedup();
    Ok(ips.into_iter().map(|ip| {
        let mac = network_mac(&ip);
        let hostname = network_hostname(&ip);
        let kind = if hostname.to_lowercase().contains("android") || hostname.to_lowercase().contains("tecno") {
            "Android probable".to_string()
        } else if hostname.to_lowercase().contains("tv") || hostname.to_lowercase().contains("box") {
            "Téléviseur / boîtier probable".to_string()
        } else if hostname.is_empty() {
            "Appareil réseau".to_string()
        } else {
            "Ordinateur / appareil réseau".to_string()
        };
        NetworkDevice { ip, hostname, mac, kind }
    }).collect())
}

#[tauri::command]
fn connect_network_android(ip: String) -> Result<String, String> {
    let parsed: std::net::Ipv4Addr = ip.parse().map_err(|_| "Adresse IPv4 invalide.".to_string())?;
    if !parsed.is_private() {
        return Err("Pour des raisons de sécurité, NEXUS CONTROL ne tente une connexion que vers une adresse IPv4 privée du réseau local.".to_string());
    }
    if !command_exists("adb") {
        return Err("ADB n'est pas installé. Installe Android platform-tools avant de connecter un téléphone.".to_string());
    }

    // ADB mDNS fournit le port dynamique du débogage sans fil lorsqu'il est publié.
    let mut endpoint = format!("{ip}:5555");
    if let Ok(output) = Command::new("adb").args(["mdns", "services"]).output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            if line.contains("_adb-tls-connect._tcp") && line.contains(&ip) {
                if let Some(candidate) = line.split_whitespace().last() {
                    if candidate.starts_with(&format!("{ip}:")) { endpoint = candidate.to_string(); break; }
                }
            }
        }
    }

    let output = Command::new("adb").arg("connect").arg(&endpoint).output()
        .map_err(|error| format!("Impossible de lancer ADB : {error}"))?;
    let response = format!("{} {}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    let devices = read_android_devices()?;
    if !devices.iter().any(|device| device.id == endpoint && device.state == "device") {
        return Err(format!("Connexion non autorisée ou indisponible sur {endpoint}. Vérifie que le débogage sans fil est activé sur le téléphone et que cet ordinateur est déjà autorisé/appairé. Réponse ADB : {}", response.trim()));
    }

    if command_exists("scrcpy") {
        Command::new("scrcpy").arg("--serial").arg(&endpoint).spawn()
            .map_err(|error| format!("ADB est connecté, mais scrcpy n'a pas pu démarrer : {error}"))?;
        Ok(format!("Téléphone connecté sur {endpoint}. scrcpy a été lancé."))
    } else {
        Ok(format!("Téléphone connecté sur {endpoint}, mais scrcpy n'est pas installé : l'écran ne peut pas encore être affiché."))
    }
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
            scan_network_devices,
            connect_network_android,
            launch_scrcpy,
            install_integration
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de NEXUS CONTROL");
}
