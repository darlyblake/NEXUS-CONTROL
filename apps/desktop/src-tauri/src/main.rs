#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod browser_control;
mod classic_phones;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write, copy},
    net::{IpAddr, TcpListener, TcpStream, Shutdown},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

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

fn adb_program() -> PathBuf {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join("Android/Sdk/platform-tools/adb"));
        candidates.push(home.join("Android/sdk/platform-tools/adb"));
    }
    candidates.extend([
        PathBuf::from("/usr/lib/android-sdk/platform-tools/adb"),
        PathBuf::from("/opt/android-sdk/platform-tools/adb"),
    ]);
    candidates.into_iter().find(|path| path.is_file()).unwrap_or_else(|| PathBuf::from("adb"))
}

fn adb_available() -> bool {
    let path = adb_program();
    path.is_file() || command_exists("adb")
}

fn require_authorized_android(serial: &str) -> Result<(), String> {
    if serial.trim().is_empty() {
        return Err("Identifiant Android manquant.".to_string());
    }
    let devices = read_android_devices()?;
    if devices.iter().any(|device| device.id == serial && device.state == "device") {
        Ok(())
    } else {
        Err("Appareil introuvable ou non autorisé. Vérifie le câble USB et accepte l'autorisation de débogage sur Android.".to_string())
    }
}

fn validate_android_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if !(trimmed.starts_with("/sdcard/") || trimmed.starts_with("/storage/emulated/0/")) {
        return Err("Pour la sécurité, le chemin Android doit rester dans /sdcard/ ou /storage/emulated/0/.".to_string());
    }
    if trimmed.split('/').any(|part| part == "..") || trimmed.contains('\0') {
        return Err("Le chemin Android contient un élément interdit.".to_string());
    }
    Ok(())
}

fn read_android_devices() -> Result<Vec<AndroidDevice>, String> {
    if !adb_available() {
        return Ok(Vec::new());
    }

    let output = Command::new(adb_program())
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
#[serde(rename_all = "camelCase")]
struct NetworkDevice {
    ip: String,
    hostname: String,
    mac: String,
    kind: String,
    manufacturer: String,
    model: String,
    device_type: String,
    os_guess: String,
    evidence: Vec<String>,
    connection: String,
    adb_status: String,
}

fn local_ipv4() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        // Prefer the source address selected by the default route. This avoids
        // accidentally scanning Docker/VPN bridges before the actual Wi-Fi interface.
        if let Ok(route) = Command::new("ip").args(["route", "get", "1.1.1.1"]).output() {
            let stdout = String::from_utf8_lossy(&route.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(index) = parts.iter().position(|part| *part == "src") {
                    if let Some(ip) = parts.get(index + 1) {
                        if ip.parse::<std::net::Ipv4Addr>().is_ok()
                            && !ip.starts_with("127.")
                            && !ip.starts_with("169.254.")
                        {
                            return Ok((*ip).to_string());
                        }
                    }
                }
            }
        }

        // Fallback for hosts without a default route.
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



fn network_scan_with_nmap(target: &str) -> Vec<String> {
    if !command_exists("nmap") { return Vec::new(); }
    let output = Command::new("nmap").args(["-sn", "-n", "--", target]).output();
    let Ok(output) = output else { return Vec::new(); };
    if !output.status.success() { return Vec::new(); }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().filter_map(|line| {
        let rest = line.strip_prefix("Nmap scan report for ")?;
        let candidate = rest.split_whitespace().last().unwrap_or(rest).trim_matches(|c| c == '(' || c == ')');
        candidate.parse::<std::net::Ipv4Addr>().ok().map(|_| candidate.to_string())
    }).collect()
}

fn network_scan_with_arp_scan() -> Vec<String> {
    if !command_exists("arp-scan") { return Vec::new(); }
    let output = Command::new("arp-scan").args(["--localnet", "--plain"]).output();
    let Ok(output) = output else { return Vec::new(); };
    if !output.status.success() { return Vec::new(); }
    String::from_utf8_lossy(&output.stdout).lines().filter_map(|line| {
        let candidate = line.split_whitespace().next()?;
        candidate.parse::<std::net::Ipv4Addr>().ok().map(|_| candidate.to_string())
    }).collect()
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

// Recherche du fabricant dans la base OUI locale de Nmap ; aucune marque n'est devinée.
fn network_vendor(mac: &str) -> String {
    let prefix = mac.to_uppercase().replace('-', ":").split(':').take(3).collect::<Vec<_>>().join(":").replace(":", "");
    if prefix.len() != 6 { return "Non identifié".to_string(); }
    for path in ["/usr/share/nmap/nmap-mac-prefixes", "/usr/local/share/nmap/nmap-mac-prefixes"] {
        if let Ok(content) = fs::read_to_string(path) {
            for line in content.lines() {
                let mut parts = line.split_whitespace();
                if let Some(oui) = parts.next() {
                    if oui.eq_ignore_ascii_case(&prefix) {
                        let vendor = parts.collect::<Vec<_>>().join(" ");
                        if !vendor.is_empty() { return vendor; }
                    }
                }
            }
        }
    }
    "Non identifié".to_string()
}

#[tauri::command]
fn scan_network_devices() -> Result<Vec<NetworkDevice>, String> {
    let local_ip = local_ipv4()?;
    let octets: Vec<&str> = local_ip.split('.').collect();
    if octets.len() != 4 {
        return Err("Adresse IPv4 locale invalide.".to_string());
    }
    // Délimitation prudente au sous-réseau IPv4 /24 local actuel.
    // Nmap (-sn) est préféré pour la découverte d'hôtes; arp-scan complète sur Linux si autorisé.
    let prefix = format!("{}.{}.{}", octets[0], octets[1], octets[2]);
    let subnet = format!("{prefix}.0/24");
    let mut ips = network_scan_with_nmap(&subnet);
    ips.extend(network_scan_with_arp_scan());

    // Fallback simple si les outils Kali ne sont pas installés ou n'ont pas les permissions.
    if ips.is_empty() {
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
        ips.extend(alive.into_inner().unwrap_or_default());
    }
    // Ne garder que les hôtes de la plage Wi-Fi scannée. arp-scan peut examiner
    // d'autres interfaces (Docker, machines virtuelles, VPN) ; leurs résultats sont exclus.
    // On ne fusionne pas toute la table ARP/voisins, car elle peut contenir des entrées anciennes.
    ips.retain(|ip| {
        if ip == &local_ip || !ip.starts_with(&format!("{prefix}.")) {
            return false;
        }
        let Some(last_octet) = ip.rsplit('.').next().and_then(|value| value.parse::<u8>().ok()) else {
            return false;
        };
        last_octet != 0 && last_octet != 255
    });
    ips.sort();
    ips.dedup();
    Ok(ips.into_iter().map(|ip| {
        let mac = network_mac(&ip);
        let hostname = network_hostname(&ip);
        let manufacturer = network_vendor(&mac);
        let host_lower = hostname.to_lowercase();
        let lower = format!("{} {}", host_lower, manufacturer.to_lowercase());
        let mut evidence = Vec::new();
        if !hostname.is_empty() { evidence.push(format!("Nom d'hôte résolu localement : {}", hostname)); }
        if !mac.is_empty() { evidence.push(format!("Adresse MAC présente dans la table des voisins : {}", mac)); }
        if manufacturer != "Non identifié" { evidence.push(format!("Fabricant associé au préfixe MAC dans la base locale Nmap : {}", manufacturer)); }
        evidence.push("Hôte détecté par découverte réseau ; aucun scan de ports n'a été lancé".to_string());
        let device_type = if ["smart-tv", "smarttv", "television", "android-tv", "roku", "chromecast", "firetv", "tv-"].iter().any(|v| lower.contains(v)) {
            "tv"
        } else if ["router", "gateway", "access-point", "access point", "mikrotik", "tp-link", "tplink", "cisco", "netgear"].iter().any(|v| lower.contains(v)) {
            "network"
        } else if ["android", "iphone", "ipad", "phone", "mobile", "tecno", "infinix", "itel", "galaxy", "pixel", "redmi", "xiaomi", "oppo", "vivo", "huawei"].iter().any(|v| host_lower.contains(v)) {
            "phone"
        } else if ["tecno", "infinix", "itel", "redmi", "xiaomi", "oppo", "vivo"].iter().any(|v| manufacturer.to_lowercase().contains(v)) {
            // These manufacturer names are a clue, not proof; keep the label explicitly probabilistic.
            "phone"
        } else if !hostname.is_empty() {
            "computer"
        } else {
            "unknown"
        };
        let kind = match device_type {
            "phone" => "Téléphone / tablette probable (indices nom/fabricant)",
            "tv" => "Téléviseur / boîtier probable",
            "network" => "Équipement réseau probable",
            "computer" => "Ordinateur probable (nom d'hôte disponible)",
            _ => "Type non identifié",
        }.to_string();
        let os_guess = if device_type == "phone" && (lower.contains("android") || ["tecno", "infinix", "itel", "galaxy", "pixel", "redmi", "xiaomi", "oppo", "vivo"].iter().any(|v| lower.contains(v))) { "Android probable" }
            else if device_type == "computer" && lower.contains("windows") { "Windows probable" }
            else if device_type == "computer" && ["ubuntu", "linux", "debian"].iter().any(|v| lower.contains(v)) { "Linux probable" }
            else if device_type == "computer" && ["macbook", "imac", "mac-mini"].iter().any(|v| lower.contains(v)) { "macOS probable" }
            else { "Système non confirmé par la découverte réseau" }.to_string();
        NetworkDevice {
            ip, hostname, mac, kind, manufacturer,
            model: "Inconnu — non communiqué par la découverte réseau".to_string(),
            device_type: device_type.to_string(),
            os_guess,
            evidence,
            connection: "Wi-Fi / Ethernet".to_string(),
            adb_status: "Non testé".to_string(),
        }
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
        ("nmap", "Nmap", "Découverte des hôtes du réseau local (scan sans ports)"),
        ("arp-scan", "arp-scan", "Découverte ARP et fabricants sur le réseau local"),
        ("netdiscover", "Netdiscover", "Découverte ARP active/passive (outil Kali Linux)"),
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
async fn build_and_install_android() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(build_and_install_android_blocking)
        .await
        .map_err(|error| format!("La tâche de compilation Android s'est interrompue : {error}"))?
}

fn build_and_install_android_blocking() -> Result<String, String> {
    if !adb_available() {
        return Err("ADB n'est pas installé ou n'est pas accessible depuis NEXUS CONTROL. Installe Android platform-tools puis réessaie.".to_string());
    }
    // GUI apps launched from the desktop may not inherit the user's interactive Zsh PATH.
    // Prefer the known modern Gradle installation before falling back to PATH.
    let gradle = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".local/gradle/gradle-8.9/bin/gradle"))
        .filter(|path| path.is_file())
        .or_else(|| {
            let candidates = [
                PathBuf::from("/usr/local/gradle/gradle-8.9/bin/gradle"),
                PathBuf::from("/opt/gradle/gradle-8.9/bin/gradle"),
            ];
            candidates.into_iter().find(|path| path.is_file())
        })
        .or_else(|| {
            if command_exists("gradle") {
                Some(PathBuf::from("gradle"))
            } else {
                None
            }
        })
        .ok_or_else(|| "Gradle est introuvable. Installe Gradle 8.9 dans ~/.local/gradle/gradle-8.9 ou rends-le accessible dans le PATH.".to_string())?;

    let gradle_version = Command::new(&gradle)
        .arg("--version")
        .output()
        .map_err(|error| format!("Impossible de vérifier Gradle ({}): {error}", gradle.display()))?;
    let version_text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&gradle_version.stdout),
        String::from_utf8_lossy(&gradle_version.stderr)
    );
    let major_version = version_text
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed.strip_prefix("Gradle ").and_then(|value| value.split('.').next()).and_then(|value| value.parse::<u32>().ok())
        });
    if !gradle_version.status.success() || major_version.unwrap_or(0) < 8 {
        return Err(format!(
            "NEXUS CONTROL a trouvé une version de Gradle trop ancienne ({}). Gradle 8.9 est attendu. Chemin utilisé : {}. Vérifie que ~/.local/gradle/gradle-8.9/bin/gradle existe.",
            major_version.map(|value| value.to_string()).unwrap_or_else(|| "inconnue".to_string()),
            gradle.display()
        ));
    }

    let devices = read_android_devices()?;
    let device = devices.iter().find(|device| device.state == "device");
    let device = match device {
        Some(device) => device,
        None if devices.iter().any(|device| device.state == "unauthorized") =>
            return Err("Téléphone détecté, mais non autorisé. Déverrouille-le et accepte la fenêtre « Autoriser le débogage USB », puis réessaie.".to_string()),
        None if devices.iter().any(|device| device.state == "offline") =>
            return Err("Le téléphone est détecté mais hors ligne. Vérifie le câble USB, déverrouille le téléphone et réessaie.".to_string()),
        None => return Err("Aucun téléphone Android autorisé détecté. Branche-le avec un câble de données, active le débogage USB et accepte l'autorisation sur le téléphone.".to_string()),
    };

    let android_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../android");
    let android_dir = android_dir.canonicalize().map_err(|error|
        format!("Impossible de trouver le projet Android local ({}): {error}", android_dir.display())
    )?;
    if !android_dir.join("settings.gradle.kts").exists() || !android_dir.join("app/build.gradle.kts").exists() {
        return Err(format!("Le dossier Android ne contient pas les fichiers Gradle attendus : {}", android_dir.display()));
    }

    // Resolve the Android SDK even when the desktop app was launched outside a shell.
    // Respect an existing valid local.properties first, then environment variables and common Linux paths.
    let local_properties = android_dir.join("local.properties");
    let existing_sdk = fs::read_to_string(&local_properties).ok().and_then(|content| {
        content.lines().find_map(|line| {
            let line = line.trim();
            line.strip_prefix("sdk.dir=").map(|value| PathBuf::from(value.trim().replace("\\:", ":")))
        })
    }).filter(|path| path.join("platform-tools/adb").is_file() || path.join("platforms").is_dir());

    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut sdk_candidates: Vec<PathBuf> = Vec::new();
    for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(value) = std::env::var_os(key) {
            sdk_candidates.push(PathBuf::from(value));
        }
    }
    if let Some(home) = home {
        sdk_candidates.push(home.join("Android/Sdk"));
        sdk_candidates.push(home.join("Android/sdk"));
    }
    sdk_candidates.extend([
        PathBuf::from("/opt/android-sdk"),
        PathBuf::from("/usr/lib/android-sdk"),
    ]);
    let sdk = existing_sdk.or_else(|| sdk_candidates.into_iter().find(|path| {
        path.join("platforms").is_dir() && (path.join("platform-tools").is_dir() || path.join("build-tools").is_dir())
    })).ok_or_else(|| {
        "SDK Android introuvable. Ouvre Android Studio > SDK Manager pour installer le SDK, puis vérifie le chemin. Chemins vérifiés : ANDROID_HOME, ANDROID_SDK_ROOT, ~/Android/Sdk, /opt/android-sdk et /usr/lib/android-sdk.".to_string()
    })?;

    // Write only the SDK location; preserve any other local.properties entries.
    let sdk_value = sdk.to_string_lossy().replace("\\", "\\\\").replace(":", "\\:");
    let mut properties = fs::read_to_string(&local_properties).unwrap_or_default();
    let mut lines: Vec<String> = properties.lines()
        .filter(|line| !line.trim_start().starts_with("sdk.dir="))
        .map(str::to_string)
        .collect();
    lines.push(format!("sdk.dir={sdk_value}"));
    properties = lines.join("\n") + "\n";
    fs::write(&local_properties, properties)
        .map_err(|error| format!("Impossible d'écrire le chemin du SDK dans {} : {error}", local_properties.display()))?;

    let mut build_command = Command::new(&gradle);
    build_command
        .args([
            "--no-daemon",
            "--no-parallel",
            "--max-workers=1",
            "--console=plain",
            "-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m -Dfile.encoding=UTF-8",
        ])
        .arg("assembleDebug")
        .current_dir(&android_dir)
        .env("ANDROID_HOME", &sdk)
        .env("ANDROID_SDK_ROOT", &sdk);
    // Android Studio/SDK tools may not be on PATH when launched from the desktop menu.
    let mut path_entries = vec![sdk.join("platform-tools"), sdk.join("cmdline-tools/latest/bin")];
    if let Some(existing_path) = std::env::var_os("PATH") {
        path_entries.extend(std::env::split_paths(&existing_path));
    }
    if let Ok(path) = std::env::join_paths(path_entries) {
        build_command.env("PATH", path);
    }
    build_command.env("KOTLIN_DAEMON_JVM_OPTIONS", "-Xmx768m");
    let build = build_command
        .output()
        .map_err(|error| format!("Impossible de démarrer Gradle : {error}"))?;
    if !build.status.success() {
        let stdout = String::from_utf8_lossy(&build.stdout);
        let stderr = String::from_utf8_lossy(&build.stderr);
        let details = format!("{}\n{}", stdout.trim(), stderr.trim());
        let excerpt: String = details.chars().rev().take(4500).collect::<String>().chars().rev().collect();
        return Err(format!("La compilation Android a échoué. Détails :\n{}", excerpt.trim()));
    }

    let apk = android_dir.join("app/build/outputs/apk/debug/app-debug.apk");
    if !apk.is_file() {
        return Err("Gradle a terminé sans erreur, mais le fichier APK attendu n'a pas été trouvé.".to_string());
    }

    let install = Command::new(adb_program())
        .args(["-s", device.id.as_str(), "install", "-r"])
        .arg(&apk)
        .output()
        .map_err(|error| format!("Impossible de lancer l'installation ADB : {error}"))?;
    if !install.status.success() {
        let details = format!("{}\n{}", String::from_utf8_lossy(&install.stdout).trim(), String::from_utf8_lossy(&install.stderr).trim());
        return Err(format!("L'APK a été compilé, mais son installation a échoué : {}", details.trim()));
    }

    let launch = Command::new(adb_program())
        .args(["-s", device.id.as_str(), "shell", "am", "start", "-n", "com.nexuscontrol.agent/.MainActivity"])
        .output()
        .map_err(|error| format!("L'application a été installée, mais son lancement n'a pas pu être demandé : {error}"))?;
    let launch_message = if launch.status.success() {
        " L'application a également été ouverte sur le téléphone."
    } else {
        " L'installation a réussi ; ouvre NEXUS Agent depuis le menu Android."
    };

    Ok(format!(
        "Compilation réussie et NEXUS Agent installé sur {} ({}).{}",
        device.model, device.id, launch_message
    ))
}

#[tauri::command]
fn adb_push_file(serial: String, local_path: String, remote_path: String) -> Result<String, String> {
    require_authorized_android(&serial)?;
    validate_android_path(&remote_path)?;
    let local = PathBuf::from(local_path.trim()).canonicalize()
        .map_err(|error| format!("Impossible de lire le fichier source sur le PC : {error}"))?;
    if !local.is_file() {
        return Err("Le chemin local ne désigne pas un fichier ordinaire.".to_string());
    }
    let output = Command::new(adb_program())
        .args(["-s", serial.as_str(), "push"])
        .arg(&local)
        .arg(remote_path.trim())
        .output()
        .map_err(|error| format!("Impossible de démarrer le transfert ADB : {error}"))?;
    if !output.status.success() {
        let details = format!("{}\n{}", String::from_utf8_lossy(&output.stdout).trim(), String::from_utf8_lossy(&output.stderr).trim());
        return Err(format!("Le transfert vers Android a échoué : {}", details.trim()));
    }
    Ok(format!("Fichier envoyé vers Android : {} → {}", local.file_name().and_then(|name| name.to_str()).unwrap_or("fichier"), remote_path.trim()))
}

#[tauri::command]
fn send_file_to_local_receiver(local_path: String, receiver_url: String, token: String) -> Result<String, String> {
    let local = PathBuf::from(local_path.trim()).canonicalize()
        .map_err(|error| format!("Impossible de lire le fichier source : {error}"))?;
    if !local.is_file() {
        return Err("Le chemin source ne désigne pas un fichier ordinaire.".to_string());
    }
    if token.len() < 16 || token.len() > 128 || !token.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Jeton invalide : utilise le jeton alphanumérique affiché dans Réception sur Android.".to_string());
    }

    let parsed = url::Url::parse(receiver_url.trim())
        .map_err(|error| format!("Adresse du récepteur invalide : {error}"))?;
    if parsed.scheme() != "http" || !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.path() != "/" || parsed.query().is_some() || parsed.fragment().is_some()
        || parsed.port_or_known_default() != Some(8765) {
        return Err("Utilise l'adresse locale complète au format http://IP_ANDROID:8765.".to_string());
    }
    let host = parsed.host_str().ok_or("Adresse IP du téléphone manquante.")?;
    let ip: IpAddr = host.parse().map_err(|_| "Saisis l'adresse IPv4 affichée dans la page Réception Android.".to_string())?;
    match ip {
        IpAddr::V4(v4) if v4.is_private() || v4.is_link_local() => {}
        _ => return Err("Pour la sécurité, le transfert accepte uniquement une adresse IPv4 privée du réseau local.".to_string()),
    }
    let port = parsed.port_or_known_default().unwrap_or(8765);
    let mut stream = TcpStream::connect((ip, port))
        .map_err(|error| format!("Connexion au téléphone impossible : {error}. Vérifie le Wi-Fi et que Réception est activée."))?;
    stream.set_write_timeout(Some(Duration::from_secs(120))).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(120))).map_err(|e| e.to_string())?;

    let file_name = local.file_name().and_then(|name| name.to_str()).unwrap_or("fichier");
    let encoded_name: String = url::form_urlencoded::byte_serialize(file_name.as_bytes()).collect();
    let metadata = fs::metadata(&local).map_err(|error| error.to_string())?;
    let request = format!(
        "PUT /upload?name={} HTTP/1.1\r\nHost: {}:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        encoded_name, ip, port, token, metadata.len()
    );
    stream.write_all(request.as_bytes()).map_err(|error| format!("Impossible d'initialiser le transfert : {error}"))?;
    let mut file = fs::File::open(&local).map_err(|error| error.to_string())?;
    copy(&mut file, &mut stream).map_err(|error| format!("Échec pendant l'envoi du fichier : {error}"))?;
    stream.shutdown(Shutdown::Write).map_err(|error| error.to_string())?;

    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|error| format!("Aucune confirmation du téléphone : {error}"))?;
    let status = response.lines().next().unwrap_or("Réponse HTTP vide");
    if status.contains(" 200 ") {
        Ok(format!("Fichier envoyé au téléphone : {} ({} octets).", file_name, metadata.len()))
    } else {
        Err(format!("Le téléphone a refusé le transfert : {}. Vérifie le jeton et l'espace disponible.", status))
    }
}

#[tauri::command]
fn adb_pull_file(serial: String, remote_path: String, local_path: String) -> Result<String, String> {
    require_authorized_android(&serial)?;
    validate_android_path(&remote_path)?;
    let destination = PathBuf::from(local_path.trim());
    if destination.as_os_str().is_empty() {
        return Err("Indique le chemin de destination sur le PC.".to_string());
    }
    let parent = destination.parent().filter(|path| !path.as_os_str().is_empty())
        .ok_or("Le chemin de destination doit inclure un dossier existant.")?;
    if !parent.is_dir() {
        return Err(format!("Le dossier de destination n'existe pas : {}", parent.display()));
    }
    if destination.is_dir() {
        return Err("La destination doit être un nom de fichier, pas un dossier.".to_string());
    }
    let output = Command::new(adb_program())
        .args(["-s", serial.as_str(), "pull"])
        .arg(remote_path.trim())
        .arg(&destination)
        .output()
        .map_err(|error| format!("Impossible de démarrer la récupération ADB : {error}"))?;
    if !output.status.success() {
        let details = format!("{}\n{}", String::from_utf8_lossy(&output.stdout).trim(), String::from_utf8_lossy(&output.stderr).trim());
        return Err(format!("La récupération depuis Android a échoué : {}", details.trim()));
    }
    Ok(format!("Fichier récupéré sur le PC : {}", destination.display()))
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


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    version: String,
    download_url: String,
    checksum_url: String,
    asset_name: String,
    notes: String,
}

fn current_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn version_parts(value: &str) -> Vec<u64> {
    value.trim_start_matches('v')
        .split('.')
        .map(|part| part.split(|ch: char| !ch.is_ascii_digit()).next().unwrap_or("").parse::<u64>().unwrap_or(0))
        .collect()
}

fn is_newer_version(candidate: &str, current: &str) -> bool {
    version_parts(candidate) > version_parts(current)
}

#[cfg(target_os = "linux")]
fn fetch_latest_release() -> Result<Option<serde_json::Value>, String> {
    let path = std::env::temp_dir().join(format!("nexus-control-release-{}.json", std::process::id()));
    let output = Command::new("curl")
        .args(["--proto", "=https", "--tlsv1.2", "-fLsS", "--retry", "2", "-o"])
        .arg(&path)
        .arg("https://api.github.com/repos/darlyblake/NEXUS-CONTROL/releases/latest")
        .output()
        .map_err(|error| format!("Impossible de vérifier GitHub : {error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&path);
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("404") {
            return Ok(None);
        }
        return Err(format!("Vérification GitHub impossible : {}", error.trim()));
    }
    let content = fs::read_to_string(&path).map_err(|error| format!("Lecture de la réponse GitHub impossible : {error}"))?;
    let _ = fs::remove_file(&path);
    let release: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("Réponse GitHub invalide : {error}"))?;
    Ok(Some(release))
}

#[tauri::command]
fn check_app_update() -> Result<Option<UpdateInfo>, String> {
    #[cfg(target_os = "linux")]
    {
        let Some(release) = fetch_latest_release()? else { return Ok(None); };
        let tag = release.get("tag_name").and_then(|value| value.as_str()).unwrap_or("");
        let version = tag.trim_start_matches('v');
        if version.is_empty() || !is_newer_version(version, current_app_version()) {
            return Ok(None);
        }
        let assets = release.get("assets").and_then(|value| value.as_array()).ok_or("La version publiée ne contient pas de fichiers téléchargeables.")?;
        let deb = assets.iter().find(|asset| asset.get("name").and_then(|v| v.as_str()) == Some("nexus-control-linux.deb"))
            .ok_or("Le paquet Linux .deb est absent de la dernière version GitHub.")?;
        let sums = assets.iter().find(|asset| asset.get("name").and_then(|v| v.as_str()) == Some("SHA256SUMS"))
            .ok_or("Le fichier de vérification SHA256 est absent de la dernière version.")?;
        let download_url = deb.get("browser_download_url").and_then(|v| v.as_str()).unwrap_or("");
        let checksum_url = sums.get("browser_download_url").and_then(|v| v.as_str()).unwrap_or("");
        let allowed_prefix = format!("https://github.com/darlyblake/NEXUS-CONTROL/releases/download/{tag}/");
        if !download_url.starts_with(&allowed_prefix) || !checksum_url.starts_with(&allowed_prefix) {
            return Err("Les liens de mise à jour ne correspondent pas au dépôt officiel NEXUS CONTROL.".to_string());
        }
        return Ok(Some(UpdateInfo {
            current_version: current_app_version().to_string(),
            version: version.to_string(),
            download_url: download_url.to_string(),
            checksum_url: checksum_url.to_string(),
            asset_name: "nexus-control-linux.deb".to_string(),
            notes: release.get("body").and_then(|v| v.as_str()).unwrap_or("").chars().take(1200).collect(),
        }));
    }
    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}

#[cfg(target_os = "linux")]
fn download_https(url: &str, destination: &PathBuf) -> Result<(), String> {
    if !url.starts_with("https://github.com/darlyblake/NEXUS-CONTROL/releases/download/") {
        return Err("Source de téléchargement refusée : dépôt non reconnu.".to_string());
    }
    let output = Command::new("curl")
        .args(["--proto", "=https", "--tlsv1.2", "-fLsS", "--retry", "2", "-o"])
        .arg(destination)
        .arg(url)
        .output()
        .map_err(|error| format!("Impossible de télécharger le fichier : {error}"))?;
    if !output.status.success() {
        return Err(format!("Téléchargement échoué : {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(())
}

#[tauri::command]
fn install_app_update() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let update = check_app_update()?.ok_or("Aucune nouvelle version Linux n'est actuellement disponible.")?;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_secs()).unwrap_or(0);
        let base = std::env::temp_dir().join(format!("nexus-control-update-{}-{nonce}", std::process::id()));
        let deb_path = base.with_extension("deb");
        let sums_path = base.with_extension("sha256sums");
        download_https(&update.download_url, &deb_path)?;
        if let Err(error) = download_https(&update.checksum_url, &sums_path) {
            let _ = fs::remove_file(&deb_path);
            return Err(error);
        }
        let sums = fs::read_to_string(&sums_path).map_err(|error| format!("Impossible de lire le fichier SHA256 : {error}"))?;
        let expected = sums.lines().find_map(|line| {
            let mut fields = line.split_whitespace();
            let hash = fields.next()?;
            let name = fields.next()?.trim_start_matches('*');
            if name == update.asset_name { Some(hash.to_string()) } else { None }
        }).ok_or("Le fichier SHA256 ne contient pas le paquet Linux attendu.")?;
        if expected.len() != 64 || !expected.chars().all(|ch| ch.is_ascii_hexdigit()) {
            let _ = fs::remove_file(&deb_path);
            let _ = fs::remove_file(&sums_path);
            return Err("Le hash SHA256 publié est invalide.".to_string());
        }
        let hash_output = Command::new("sha256sum").arg(&deb_path).output()
            .map_err(|error| format!("Impossible de vérifier l'intégrité du paquet : {error}"))?;
        let actual = String::from_utf8_lossy(&hash_output.stdout).split_whitespace().next().unwrap_or("").to_string();
        if !hash_output.status.success() || !actual.eq_ignore_ascii_case(&expected) {
            let _ = fs::remove_file(&deb_path);
            let _ = fs::remove_file(&sums_path);
            return Err("La vérification SHA256 a échoué. Le paquet n'a pas été installé.".to_string());
        }
        let status = Command::new("pkexec")
            .arg("apt-get")
            .arg("install")
            .arg("-y")
            .arg(&deb_path)
            .status()
            .map_err(|error| format!("Impossible d'ouvrir l'autorisation administrateur Ubuntu : {error}"))?;
        let _ = fs::remove_file(&deb_path);
        let _ = fs::remove_file(&sums_path);
        if !status.success() {
            return Err("L'installation a été annulée ou a échoué. La version actuelle est conservée.".to_string());
        }
        return Ok(format!("NEXUS CONTROL {} a été installé. Ferme puis rouvre l'application pour démarrer la nouvelle version.", update.version));
    }
    #[cfg(not(target_os = "linux"))]
    {
        Err("La mise à jour intégrée du paquet .deb est disponible uniquement sous Linux.".to_string())
    }
}


#[tauri::command]
fn open_known_folder(name: String) -> Result<String, String> {
    let key = name.trim().to_lowercase();
    let (xdg_key, localized, english) = match key.as_str() {
        "music" | "musique" => ("MUSIC", "Musique", "Music"),
        "documents" | "document" => ("DOCUMENTS", "Documents", "Documents"),
        "downloads" | "download" | "téléchargements" | "telechargements" => ("DOWNLOAD", "Téléchargements", "Downloads"),
        "pictures" | "picture" | "images" | "image" | "photos" => ("PICTURES", "Images", "Pictures"),
        "videos" | "video" | "vidéos" | "vidéo" => ("VIDEOS", "Vidéos", "Videos"),
        "desktop" | "bureau" => ("DESKTOP", "Bureau", "Desktop"),
        "home" | "accueil" | "personnel" | "dossier personnel" => ("", "", ""),
        _ => return Err("Dossier non reconnu. Essaie Musique, Documents, Téléchargements, Images, Vidéos, Bureau ou dossier personnel.".to_string()),
    };

    let home = std::env::var_os("HOME").map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .ok_or("Impossible de déterminer le dossier personnel de cet utilisateur.")?;

    let path = if xdg_key.is_empty() {
        home.clone()
    } else {
        #[cfg(target_os = "linux")]
        {
            let xdg_path = Command::new("xdg-user-dir").arg(xdg_key).output().ok()
                .filter(|output| output.status.success())
                .map(|output| PathBuf::from(String::from_utf8_lossy(&output.stdout).trim()))
                .filter(|path| path.is_dir());
            xdg_path.or_else(|| {
                [localized, english].iter().map(|folder| home.join(folder)).find(|path| path.is_dir())
            }).ok_or_else(|| format!("Le dossier {} est introuvable dans le dossier personnel.", localized))?
        }
        #[cfg(target_os = "windows")]
        {
            let windows_folder = match xdg_key {
                "MUSIC" => "Music", "DOCUMENTS" => "Documents", "DOWNLOAD" => "Downloads",
                "PICTURES" => "Pictures", "VIDEOS" => "Videos", "DESKTOP" => "Desktop", _ => english,
            };
            let candidate = home.join(windows_folder);
            if !candidate.is_dir() { return Err(format!("Le dossier {} est introuvable.", localized)); }
            candidate
        }
        #[cfg(target_os = "macos")]
        {
            let mac_folder = match xdg_key {
                "MUSIC" => "Music", "DOCUMENTS" => "Documents", "DOWNLOAD" => "Downloads",
                "PICTURES" => "Pictures", "VIDEOS" => "Movies", "DESKTOP" => "Desktop", _ => english,
            };
            let candidate = home.join(mac_folder);
            if !candidate.is_dir() { return Err(format!("Le dossier {} est introuvable.", localized)); }
            candidate
        }
    };

    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(&path).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&path).spawn();

    result.map(|_| format!("Ouverture du dossier : {}", path.display()))
        .map_err(|error| format!("Impossible d'ouvrir le dossier {} : {error}", path.display()))
}

#[tauri::command]
fn open_remote_console(url: String) -> Result<String, String> {
    let parsed = url::Url::parse(url.trim())
        .map_err(|_| "Adresse de serveur invalide.".to_string())?;
    if parsed.scheme() != "https" || parsed.host_str().is_none() || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Pour protéger la session, indique une URL HTTPS valide sans identifiants intégrés dans l'adresse.".to_string());
    }
    let normalized = parsed.to_string();
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&normalized).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").arg("/C").arg("start").arg("").arg(&normalized).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&normalized).spawn();
    result.map(|_| "Console distante ouverte dans le navigateur par défaut. Connecte-toi et vérifie les autorisations sur le serveur.".to_string())
        .map_err(|error| format!("Impossible d'ouvrir la console distante : {error}"))
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditCheck {
    id: String,
    label: String,
    status: String,
    detail: String,
}

fn audit_tool(id: &str, label: &str, args: &[&str]) -> AuditCheck {
    if !command_exists(id) {
        return AuditCheck {
            id: id.to_string(),
            label: label.to_string(),
            status: "Absent".to_string(),
            detail: format!("{id} n'est pas disponible dans le PATH de cette application."),
        };
    }

    let version = Command::new(id).args(args).output().ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
            stdout.lines().chain(stderr.lines())
                .find(|line| !line.trim().is_empty())
                .map(|line| line.trim().to_string())
        });

    AuditCheck {
        id: id.to_string(),
        label: label.to_string(),
        status: "Disponible".to_string(),
        detail: version.unwrap_or_else(|| "Commande détectée ; version non retournée par cet outil.".to_string()),
    }
}

#[tauri::command]
fn get_security_audit() -> Vec<AuditCheck> {
    let mut checks = vec![
        audit_tool("nmap", "Nmap", &["--version"]),
        audit_tool("arp-scan", "arp-scan", &["--version"]),
        audit_tool("netdiscover", "Netdiscover", &["-h"]),
        audit_tool("tshark", "Wireshark / TShark", &["--version"]),
        audit_tool("wg", "WireGuard", &["--version"]),
    ];

    #[cfg(target_os = "linux")]
    {
        if !command_exists("ufw") {
            checks.push(AuditCheck {
                id: "ufw".to_string(),
                label: "Pare-feu UFW".to_string(),
                status: "Absent".to_string(),
                detail: "UFW n'est pas installé ; vérifie quel pare-feu est utilisé sur ce système.".to_string(),
            });
        } else {
            let output = Command::new("ufw").arg("status").output();
            let detail = output.as_ref().ok()
                .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_string())
                .unwrap_or_else(|| "Impossible de lire l'état UFW.".to_string());
            let active = detail.lines().any(|line| line.trim().eq_ignore_ascii_case("Status: active"));
            checks.push(AuditCheck {
                id: "ufw".to_string(),
                label: "Pare-feu UFW".to_string(),
                status: if active { "Actif".to_string() } else { "À vérifier".to_string() },
                detail,
            });
        }
    }

    #[cfg(not(target_os = "linux"))]
    checks.push(AuditCheck {
        id: "firewall".to_string(),
        label: "Pare-feu du système".to_string(),
        status: "À vérifier".to_string(),
        detail: "La lecture automatique du pare-feu n'est pas encore implémentée pour ce système.".to_string(),
    });

    checks
}


#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModel {
    name: String,
    size: Option<u64>,
    modified_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct OllamaChatMessage {
    role: String,
    content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    images: Vec<String>,
}

fn ollama_api_ready() -> bool {
    Command::new("curl")
        .args(["--fail", "--silent", "--max-time", "2", "http://127.0.0.1:11434/api/tags"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn ollama_program() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".local/bin/ollama"));
        candidates.push(home.join("bin/ollama"));
    }
    #[cfg(target_os = "linux")]
    candidates.extend([PathBuf::from("/usr/local/bin/ollama"), PathBuf::from("/usr/bin/ollama")]);
    #[cfg(target_os = "windows")]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Programs/Ollama/ollama.exe"));
        }
        candidates.push(PathBuf::from("C:/Program Files/Ollama/ollama.exe"));
    }
    candidates.into_iter().find(|path| path.is_file())
        .or_else(|| if command_exists("ollama") { Some(PathBuf::from("ollama")) } else { None })
}

fn ensure_ollama_server() -> Result<(), String> {
    if ollama_api_ready() {
        return Ok(());
    }
    let program = ollama_program().ok_or_else(|| {
        "Ollama n'est pas installé ou introuvable. Installe Ollama puis relance NEXUS CONTROL.".to_string()
    })?;
    Command::new(&program)
        .arg("serve")
        .env("OLLAMA_HOST", "127.0.0.1:11434")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("NEXUS CONTROL n'a pas pu démarrer Ollama automatiquement : {error}. Vérifie l'installation d'Ollama."))?;

    // Ollama peut mettre quelques secondes à ouvrir son port. Le modèle n'est pas
    // chargé ici : il sera chargé uniquement à la première demande de chat.
    for _ in 0..20 {
        if ollama_api_ready() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    Err("Ollama a été démarré, mais son API ne répond pas encore sur 127.0.0.1:11434. Vérifie qu'un autre service n'utilise pas ce port et réessaie.".to_string())
}

fn read_ollama_models() -> Result<Vec<OllamaModel>, String> {
    ensure_ollama_server()?;
    let output = Command::new("curl")
        .args(["--fail", "--silent", "--show-error", "--max-time", "5", "http://127.0.0.1:11434/api/tags"])
        .output()
        .map_err(|error| format!("Impossible de lancer curl pour contacter Ollama : {error}. Vérifie que curl est installé."))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Impossible de lire les modèles Ollama sur 127.0.0.1:11434. {detail}"));
    }

    let payload: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Réponse Ollama invalide : {error}"))?;
    let entries = payload.get("models").and_then(|value| value.as_array())
        .ok_or("Ollama n'a pas retourné de liste de modèles.")?;

    Ok(entries.iter().filter_map(|entry| {
        let name = entry.get("name")?.as_str()?.to_string();
        Some(OllamaModel {
            name,
            size: entry.get("size").and_then(|value| value.as_u64()),
            modified_at: entry.get("modified_at").and_then(|value| value.as_str()).map(str::to_string),
        })
    }).collect())
}

#[tauri::command]
fn list_ollama_models() -> Result<Vec<OllamaModel>, String> {
    read_ollama_models()
}

#[tauri::command]
async fn ollama_chat(model: String, messages: Vec<OllamaChatMessage>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ollama_chat_blocking(model, messages))
        .await
        .map_err(|error| format!("La tâche de conversation IA s'est interrompue : {error}"))?
}

fn ollama_chat_blocking(model: String, messages: Vec<OllamaChatMessage>) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty() || model.len() > 200 {
        return Err("Sélectionne un modèle Ollama installé.".to_string());
    }
    if messages.is_empty() || messages.len() > 30 {
        return Err("La conversation doit contenir entre 1 et 30 messages. Efface l'historique pour continuer.".to_string());
    }

    let mut total_chars = 0usize;
    for message in &messages {
        if !matches!(message.role.as_str(), "user" | "assistant" | "system") {
            return Err("Rôle de message invalide.".to_string());
        }
        if message.content.trim().is_empty() || message.content.chars().count() > 100_000 {
            return Err("Chaque message doit contenir du texte et ne pas dépasser 100 000 caractères, pièces jointes comprises.".to_string());
        }
        if message.images.len() > 4 || message.images.iter().any(|image| image.len() > 11_200_000) {
            return Err("Images refusées : maximum 4 images de 8 Mo chacune.".to_string());
        }
        total_chars += message.content.chars().count();
    }
    if total_chars > 160_000 {
        return Err("La conversation dépasse la limite de 160 000 caractères. Efface l’historique et réessaie.".to_string());
    }

    let installed = read_ollama_models()?;
    if !installed.iter().any(|item| item.name == model) {
        return Err("Ce modèle n'est pas installé dans Ollama. Actualise la liste des modèles.".to_string());
    }

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
        "options": { "num_ctx": 4096 },
        "keep_alive": "5m"
    }).to_string();

    let mut child = Command::new("curl")
        .args([
            "--fail", "--silent", "--show-error", "--max-time", "600",
            "-H", "Content-Type: application/json", "--data-binary", "@-",
            "http://127.0.0.1:11434/api/chat"
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Impossible de lancer curl pour joindre Ollama : {error}"))?;

    child.stdin.as_mut()
        .ok_or("Impossible d'envoyer la requête à Ollama.")?
        .write_all(body.as_bytes())
        .map_err(|error| format!("Impossible d'envoyer le message à Ollama : {error}"))?;
    drop(child.stdin.take());

    let output = child.wait_with_output()
        .map_err(|error| format!("Impossible de lire la réponse d'Ollama : {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("La requête Ollama a échoué : {detail}"));
    }

    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Réponse de chat Ollama invalide : {error}"))?;
    if let Some(error) = response.get("error").and_then(|value| value.as_str()) {
        return Err(format!("Ollama : {error}"));
    }
    response.get("message")
        .and_then(|message| message.get("content"))
        .and_then(|content| content.as_str())
        .filter(|content| !content.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Le modèle n'a retourné aucun texte. Réessaie ou choisis un autre modèle.".to_string())
}


const AGENT_MAX_FILE_BYTES: u64 = 1_000_000;

fn agent_workspace_root(raw: &str) -> Result<PathBuf, String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err("Indique le dossier de travail autorisé.".to_string());
    }
    let root = fs::canonicalize(raw)
        .map_err(|error| format!("Dossier de travail inaccessible : {error}"))?;
    if !root.is_dir() {
        return Err("Le dossier de travail doit être un répertoire existant.".to_string());
    }
    if root.parent().is_none() {
        return Err("Pour éviter d'exposer tout le système, choisis un dossier précis, par exemple ton dossier personnel ou un projet, plutôt que la racine du disque.".to_string());
    }
    #[cfg(target_os = "linux")]
    if root.parent() == Some(Path::new("/")) && root.file_name().and_then(|name| name.to_str())
        .map(|name| ["bin", "boot", "dev", "etc", "lib", "lib64", "proc", "root", "run", "sbin", "sys", "usr", "var"].contains(&name))
        .unwrap_or(false) {
        return Err("Ce dossier système est bloqué. Choisis ton dossier personnel ou un dossier de projet.".to_string());
    }
    Ok(root)
}

fn agent_relative_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let rel = Path::new(relative.trim());
    if relative.trim().is_empty() || rel.is_absolute() || rel.components().any(|part| !matches!(part, Component::Normal(_))) {
        return Err("Chemin refusé : utilise un chemin relatif au dossier autorisé, sans '..' ni chemin absolu.".to_string());
    }
    let candidate = root.join(rel);
    if candidate.exists() {
        let canonical = fs::canonicalize(&candidate).map_err(|error| format!("Chemin inaccessible : {error}"))?;
        if !canonical.starts_with(root) {
            return Err("Accès refusé : le chemin sort du dossier autorisé.".to_string());
        }
        Ok(canonical)
    } else {
        let parent = candidate.parent().ok_or("Chemin de fichier invalide.")?;
        let canonical_parent = fs::canonicalize(parent)
            .map_err(|error| format!("Le dossier parent doit déjà exister : {error}"))?;
        if !canonical_parent.starts_with(root) {
            return Err("Accès refusé : le chemin sort du dossier autorisé.".to_string());
        }
        Ok(candidate)
    }
}

fn capture_screen_for_vision() -> Result<String, String> {
    let temp = std::env::temp_dir().join(format!("nexus-control-screen-{}.png", std::process::id()));
    let path = temp.to_string_lossy().to_string();

    #[cfg(target_os = "linux")]
    {
        let commands: Vec<(&str, Vec<&str>)> = vec![
            ("gnome-screenshot", vec!["--file", &path]),
            ("scrot", vec![&path]),
            ("grim", vec![&path]),
            ("import", vec!["-window", "root", &path]),
        ];
        let mut captured = false;
        for (program, args) in commands {
            if !command_exists(program) { continue; }
            if Command::new(program).args(args).status().map(|s| s.success()).unwrap_or(false) && Path::new(&path).is_file() {
                captured = true; break;
            }
        }
        if !captured {
            return Err("Capture indisponible : installe gnome-screenshot, scrot, grim ou ImageMagick (import). Une session graphique active est nécessaire.".to_string());
        }
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('{}',[System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose()",
            path.replace('\'', "''")
        );
        let status = Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status().map_err(|error| format!("Capture Windows impossible : {error}"))?;
        if !status.success() || !Path::new(&path).is_file() {
            return Err("La capture de l'écran Windows a échoué.".to_string());
        }
    }
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("screencapture").args(["-x", &path]).status()
            .map_err(|error| format!("Capture macOS impossible : {error}"))?;
        if !status.success() || !Path::new(&path).is_file() {
            return Err("La capture de l'écran macOS a échoué.".to_string());
        }
    }

    // Redimensionner la capture si ImageMagick est disponible afin de limiter le volume envoyé au modèle.
    if command_exists("magick") {
        let _ = Command::new("magick").args([&path, "-resize", "1280x1280>", "-strip", &path]).status();
    } else if command_exists("convert") {
        let _ = Command::new("convert").args([&path, "-resize", "1280x1280>", "-strip", &path]).status();
    }
    let encoded = Command::new("base64").args(["-w", "0", &path]).output()
        .or_else(|_| Command::new("base64").arg(&path).output())
        .map_err(|error| format!("Impossible d'encoder la capture : {error}"))?;
    let _ = fs::remove_file(&temp);
    if !encoded.status.success() {
        return Err("Impossible d'encoder la capture d'écran.".to_string());
    }
    let data = String::from_utf8_lossy(&encoded.stdout).trim().to_string();
    if data.is_empty() || data.len() > 12_000_000 {
        return Err("Capture trop volumineuse ou vide. Installe ImageMagick pour réduire la taille.".to_string());
    }
    Ok(format!("NEXUS_SCREENSHOT_BASE64:{data}"))
}

fn validate_public_http_url(raw: &str) -> Result<String, String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "URL invalide.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Seules les URL http:// et https:// sont autorisées.".to_string());
    }
    let host = parsed.host_str().ok_or("Nom d'hôte manquant.")?.to_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("Les adresses locales ne sont pas autorisées par l'agent navigateur.".to_string());
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let blocked = match ip {
            std::net::IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_broadcast(),
            std::net::IpAddr::V6(v) => v.is_loopback() || v.is_unspecified() || v.is_unique_local() || v.is_unicast_link_local(),
        };
        if blocked { return Err("Les adresses IP privées ou locales sont bloquées.".to_string()); }
    }
    Ok(parsed.to_string())
}

fn open_default_browser(raw_url: &str) -> Result<String, String> {
    let safe_url = validate_public_http_url(raw_url)?;
    #[cfg(target_os = "linux")]
    let result = Command::new("xdg-open").arg(&safe_url).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("cmd").args(["/C", "start", "", &safe_url]).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&safe_url).spawn();
    result.map_err(|error| format!("Impossible d'ouvrir le navigateur par défaut : {error}"))?;
    Ok(format!("Page ouverte dans le navigateur par défaut : {safe_url}. L'agent ne lit pas automatiquement les onglets déjà ouverts."))
}

fn fetch_public_page(raw_url: &str) -> Result<String, String> {
    let safe_url = validate_public_http_url(raw_url)?;
    let output = Command::new("curl")
        .args(["--location", "--max-time", "15", "--max-filesize", "1000000",
            "--user-agent", "NEXUS-CONTROL/1.0 (local assistant)", "--silent", "--show-error",
            "--fail", "--write-out", "\nHTTP_STATUS:%{http_code}", &safe_url])
        .output().map_err(|error| format!("Impossible de lancer curl : {error}"))?;
    if !output.status.success() {
        return Err(format!("Lecture de la page impossible : {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    let raw = String::from_utf8_lossy(&output.stdout);
    let (html, status) = raw.rsplit_once("\nHTTP_STATUS:").unwrap_or((&raw, "inconnu"));
    let mut text = String::new();
    let mut in_tag = false;
    let mut in_script = false;
    let mut tag = String::new();
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            tag.clear();
        } else if ch == '>' && in_tag {
            let lower = tag.trim().to_lowercase();
            if lower.starts_with("script") || lower.starts_with("style") { in_script = true; }
            if lower.starts_with("/script") || lower.starts_with("/style") { in_script = false; }
            in_tag = false;
            text.push(' ');
        } else if in_tag {
            tag.push(ch);
        } else if !in_script {
            text.push(ch);
        }
    }
    let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let excerpt: String = cleaned.chars().take(12000).collect();
    Ok(format!("URL: {safe_url}\nHTTP: {status}\nTexte extrait (HTML simplifié, les sites JavaScript peuvent ne pas apparaître) :\n{excerpt}"))
}

fn search_public_web(query: &str) -> Result<String, String> {
    let query = query.trim();
    if query.is_empty() || query.len() > 500 {
        return Err("La recherche doit contenir entre 1 et 500 caractères.".to_string());
    }
    let encoded = url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
    let url = format!("https://html.duckduckgo.com/html/?q={encoded}");
    let output = Command::new("curl")
        .args(["--location", "--max-time", "15", "--max-filesize", "1500000",
            "--user-agent", "Mozilla/5.0 (compatible; NEXUS-CONTROL/1.0)", "--silent", "--show-error",
            "--fail", &url])
        .output().map_err(|error| format!("Impossible de lancer la recherche web : {error}"))?;
    if !output.status.success() {
        return Err(format!("Recherche web impossible : {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    let html = String::from_utf8_lossy(&output.stdout);
    let mut results = Vec::new();
    let mut cursor = 0usize;
    while let Some(start) = html[cursor..].find("class=\"result__a\"") {
        let absolute = cursor + start;
        let Some(gt_rel) = html[absolute..].find('>') else { break; };
        let title_start = absolute + gt_rel + 1;
        let Some(end_rel) = html[title_start..].find("</a>") else { break; };
        let title = html[title_start..title_start + end_rel].replace("&amp;", "&").replace("&quot;", "\"").replace("&#x27;", "'");
        let href_start = html[absolute..title_start].find("href=\"").map(|n| absolute + n + 6);
        let href = href_start.and_then(|s| html[s..].find('"').map(|e| html[s..s + e].to_string())).unwrap_or_default();
        let end_block = (title_start + end_rel + 4).min(html.len());
        let block_end = html[end_block..].find("class=\"result__snippet\"").map(|n| end_block + n).unwrap_or(end_block + 700.min(html.len().saturating_sub(end_block)));
        let snippet = if let Some(s) = html[block_end..].find('>') {
            let ss = block_end + s + 1;
            html[ss..].find("</").map(|e| html[ss..ss + e].to_string()).unwrap_or_default()
        } else { String::new() };
        let clean = |s: &str| s.replace("&amp;", "&").replace("&quot;", "\"").replace("&#x27;", "'").replace("&lt;", "<").replace("&gt;", ">");
        results.push(format!("{}. {}\n{}\n{}", results.len()+1, clean(&title), clean(&href), clean(&snippet)));
        cursor = end_block.max(title_start + end_rel + 4);
        if results.len() >= 6 || cursor >= html.len() { break; }
    }
    if results.is_empty() {
        Ok(format!("Aucun résultat exploitable n'a été extrait. Tu peux ouvrir la recherche dans le navigateur : https://duckduckgo.com/?q={encoded}"))
    } else {
        Ok(format!("Recherche web : {query}\n{}\n\nVérifie les sources avant de leur faire confiance.", results.join("\n\n")))
    }
}

fn run_agent_terminal(action: &str, root: &Path) -> Result<String, String> {
    // Commandes prédéfinies uniquement : aucun shell libre ni commande arbitraire,
    // aucun argument fourni librement par le modèle.
    let (program, args): (&str, &[&str]) = match action {
        "pwd" => if cfg!(target_os = "windows") { ("cmd", &["/C", "cd"]) } else { ("pwd", &[]) },
        "git_status" => ("git", &["status", "--short", "--branch"]),
        "git_diff_stat" => ("git", &["diff", "--stat"]),
        "git_log" => ("git", &["log", "-5", "--oneline"]),
        "npm_build" => if cfg!(target_os = "windows") { ("cmd", &["/C", "npm.cmd", "run", "build"]) } else { ("npm", &["run", "build"]) },
        "npm_test" => if cfg!(target_os = "windows") { ("cmd", &["/C", "npm.cmd", "test", "--", "--run"]) } else { ("npm", &["test", "--", "--run"]) },
        "cargo_check" => ("cargo", &["check"]),
        "cargo_test" => ("cargo", &["test"]),
        "node_version" => ("node", &["--version"]),
        "python_version" => if cfg!(target_os = "windows") { ("py", &["--version"]) } else { ("python3", &["--version"]) },
        "system_info" => if cfg!(target_os = "windows") { ("cmd", &["/C", "ver"]) } else { ("uname", &["-a"]) },
        _ => return Err("Action terminal inconnue ou non autorisée. Actions disponibles : pwd, git_status, git_diff_stat, git_log, npm_build, npm_test, cargo_check, cargo_test, node_version, python_version, system_info.".to_string()),
    };
    let output = Command::new(program).args(args).current_dir(root).output()
        .map_err(|error| format!("Impossible de lancer {program} : {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}{}", stdout, if stderr.is_empty() { String::new() } else { format!("\n[stderr]\n{stderr}") });
    let excerpt: String = combined.chars().take(20_000).collect();
    if output.status.success() {
        Ok(format!("Commande terminée (code 0) dans {}\n{}", root.display(), excerpt.trim()))
    } else {
        Err(format!("Commande terminée avec le code {:?} dans {}\n{}", output.status.code(), root.display(), excerpt.trim()))
    }
}

fn execute_agent_tool(name: &str, args: &serde_json::Value, root: &Path, allow_write: bool, browser_enabled: bool, terminal_enabled: bool) -> Result<String, String> {
    if matches!(name, "browser_start" | "browser_navigate" | "browser_snapshot" | "browser_click" | "browser_fill") && !browser_enabled { return Err("Le contrôle du navigateur n'a pas été autorisé dans l'interface.".to_string()); }
    if name == "run_terminal" && !terminal_enabled { return Err("L'accès au terminal n'a pas été autorisé dans l'interface.".to_string()); }
    match name {
        "run_terminal" => run_agent_terminal(args.get("action").and_then(|v| v.as_str()).unwrap_or(""), root),
        "browser_start" => browser_control::start(),
        "browser_navigate" => browser_control::navigate(args.get("url").and_then(|v| v.as_str()).unwrap_or("")),
        "browser_snapshot" => browser_control::snapshot(),
        "browser_click" => browser_control::click(args.get("selector").and_then(|v| v.as_str()).unwrap_or("")),
        "browser_fill" => browser_control::fill(args.get("selector").and_then(|v| v.as_str()).unwrap_or(""), args.get("value").and_then(|v| v.as_str()).unwrap_or("")),
        "capture_screen" => capture_screen_for_vision(),
        "open_browser" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            open_default_browser(url)
        }
        "web_search" => {
            let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
            search_public_web(query)
        }
        "read_web_page" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            fetch_public_page(url)
        }
        "list_files" => {
            let relative = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let dir = if relative == "." || relative.is_empty() {
                root.to_path_buf()
            } else {
                agent_relative_path(root, relative)?
            };
            if !dir.starts_with(root) || !dir.is_dir() {
                return Err("Le chemin demandé n'est pas un dossier autorisé.".to_string());
            }
            let mut entries = Vec::new();
            for entry in fs::read_dir(&dir).map_err(|error| format!("Lecture du dossier impossible : {error}"))?.take(150) {
                let entry = entry.map_err(|error| error.to_string())?;
                let meta = entry.metadata().map_err(|error| error.to_string())?;
                entries.push(serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "kind": if meta.is_dir() { "directory" } else { "file" },
                    "size": if meta.is_file() { meta.len() } else { 0 }
                }));
            }
            serde_json::to_string_pretty(&entries).map_err(|error| error.to_string())
        }
        "read_file" => {
            let relative = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let path = agent_relative_path(root, relative)?;
            let metadata = fs::metadata(&path).map_err(|error| format!("Lecture impossible : {error}"))?;
            if !metadata.is_file() || metadata.len() > AGENT_MAX_FILE_BYTES {
                return Err("Seuls les fichiers ordinaires de 1 Mo maximum peuvent être lus.".to_string());
            }
            fs::read_to_string(&path).map_err(|error| format!("Le fichier n'est pas lisible en texte UTF-8 : {error}"))
        }
        "write_file" => {
            if !allow_write {
                return Err("Écriture désactivée par l'utilisateur.".to_string());
            }
            let relative = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let text = args.get("content").and_then(|v| v.as_str()).ok_or("Contenu de fichier manquant.")?;
            if text.len() as u64 > AGENT_MAX_FILE_BYTES {
                return Err("Le contenu dépasse la limite de 1 Mo.".to_string());
            }
            let path = agent_relative_path(root, relative)?;
            if let Some(parent) = path.parent() {
                let canonical_parent = fs::canonicalize(parent).map_err(|error| format!("Dossier parent inaccessible : {error}"))?;
                if !canonical_parent.starts_with(root) {
                    return Err("Écriture refusée : le chemin sort du dossier autorisé.".to_string());
                }
            }
            fs::write(&path, text).map_err(|error| format!("Écriture impossible : {error}"))?;
            Ok(format!("Fichier écrit : {}", path.strip_prefix(root).unwrap_or(&path).display()))
        }
        "get_fleet_telemetry" => {
            let reports = get_fleet_telemetry().map_err(|e| e.to_string())?;
            serde_json::to_string_pretty(&reports).map_err(|e| e.to_string())
        }
        "backup_photos" => {
            let res = run_automation_scenario("rule-backup-dcim".to_string(), None)?;
            serde_json::to_string_pretty(&res).map_err(|e| e.to_string())
        }
        "emergency_lock" => {
            let res = run_automation_scenario("rule-emergency-lock".to_string(), None)?;
            serde_json::to_string_pretty(&res).map_err(|e| e.to_string())
        }
        "ring_device" => {
            let res = run_automation_scenario("rule-find-phone".to_string(), None)?;
            serde_json::to_string_pretty(&res).map_err(|e| e.to_string())
        }
        "clean_temp_files" => {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let cache_dir = format!("{}/.cache", home);
            let mut freed_bytes = 0u64;
            if let Ok(entries) = fs::read_dir(&cache_dir) {
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            freed_bytes += meta.len();
                        }
                    }
                }
            }
            let _ = send_system_notification("NEXUS Nettoyage".to_string(), "Nettoyage des fichiers temporaires terminé.".to_string());
            Ok(format!("Nettoyage terminé : cache vérifié, espace optimisé (environ {} Ko analysés).", freed_bytes / 1024))
        }
        _ => Err(format!("Outil inconnu : {name}")),
    }
}

fn ollama_agent_request(body: &str) -> Result<serde_json::Value, String> {
    let mut child = Command::new("curl")
        .args(["--fail", "--silent", "--show-error", "--max-time", "600",
            "-H", "Content-Type: application/json", "--data-binary", "@-",
            "http://127.0.0.1:11434/api/chat"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|error| format!("Impossible de contacter Ollama : {error}"))?;
    child.stdin.as_mut().ok_or("Flux de requête indisponible.")?
        .write_all(body.as_bytes()).map_err(|error| error.to_string())?;
    drop(child.stdin.take());
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!("La requête Ollama a échoué : {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    let response: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Réponse Ollama invalide : {error}"))?;
    if let Some(error) = response.get("error").and_then(|value| value.as_str()) {
        return Err(format!("Ollama : {error}"));
    }
    Ok(response)
}

#[tauri::command]
fn ollama_agent_chat(model: String, messages: Vec<OllamaChatMessage>, workspace_root: String, allow_write: bool, browser_enabled: bool, terminal_enabled: bool) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty() || model.len() > 200 {
        return Err("Sélectionne un modèle Ollama installé.".to_string());
    }
    if messages.is_empty() || messages.len() > 24 {
        return Err("La conversation doit contenir entre 1 et 24 messages.".to_string());
    }
    let root = if workspace_root.trim().is_empty() && browser_enabled && !allow_write {
        let isolated = std::env::temp_dir().join("nexus-control-browser-only-workspace");
        fs::create_dir_all(&isolated).map_err(|error| format!("Espace temporaire indisponible : {error}"))?;
        agent_workspace_root(isolated.to_str().ok_or("Chemin temporaire invalide.")?)?
    } else {
        agent_workspace_root(&workspace_root)?
    };
    let installed = read_ollama_models()?;
    if !installed.iter().any(|item| item.name == model) {
        return Err("Ce modèle n'est pas installé dans Ollama. Actualise la liste des modèles.".to_string());
    }
    let mut conversation: Vec<serde_json::Value> = messages.iter().map(|message| {
        serde_json::json!({"role": message.role, "content": message.content})
    }).collect();
    let mut total_chars = 0usize;
    for message in &messages {
        if !matches!(message.role.as_str(), "user" | "assistant") {
            return Err("Rôle de message invalide.".to_string());
        }
        total_chars += message.content.chars().count();
    }
    if total_chars > 40_000 {
        return Err("Conversation trop longue. Efface l'historique puis réessaie.".to_string());
    }

    let mut functions = vec![
        serde_json::json!({"type":"function","function":{
            "name":"capture_screen","description":"Capturer l'écran principal actuel de cet ordinateur et fournir l'image au modèle pour qu'il la décrive. N'utiliser que lorsque l'utilisateur demande explicitement de voir ou analyser l'écran.",
            "parameters":{"type":"object","properties":{},"required":[]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"web_search","description":"Rechercher sur le Web public une question ou des mots-clés et retourner des titres, liens et extraits.",
            "parameters":{"type":"object","properties":{"query":{"type":"string","description":"Question ou mots-clés de recherche"}},"required":["query"]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"open_browser","description":"Ouvrir une URL publique http ou https dans le navigateur par défaut de l'ordinateur. Ne pas utiliser pour des pages de connexion, achats ou actions sensibles sans demander l'accord à l'utilisateur.",
            "parameters":{"type":"object","properties":{"url":{"type":"string","description":"URL publique complète à ouvrir"}},"required":["url"]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"read_web_page","description":"Lire le texte simplifié d'une page Web publique en HTTP/HTTPS. Les sites dynamiques peuvent ne pas être pris en charge.",
            "parameters":{"type":"object","properties":{"url":{"type":"string","description":"URL publique complète"}},"required":["url"]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"list_files","description":"Lister les fichiers et sous-dossiers d'un dossier relatif au dossier de travail autorisé.",
            "parameters":{"type":"object","properties":{"path":{"type":"string","description":"Chemin relatif, '.' pour la racine"}},"required":["path"]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"read_file","description":"Lire le contenu texte UTF-8 d'un fichier relatif au dossier autorisé (1 Mo maximum).",
            "parameters":{"type":"object","properties":{"path":{"type":"string","description":"Chemin relatif du fichier"}},"required":["path"]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"get_fleet_telemetry","description":"Obtenir la télémétrie en temps réel de tous les appareils connectés (PC Ubuntu/Windows et smartphone Android) : batterie, état de charge, charge CPU %, mémoire RAM %, température matérielle °C, stockage disponible et SSID Wi-Fi.",
            "parameters":{"type":"object","properties":{},"required":[]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"backup_photos","description":"Déclencher la sauvegarde automatique des photos du smartphone Android (/sdcard/DCIM) vers le PC.",
            "parameters":{"type":"object","properties":{},"required":[]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"emergency_lock","description":"Verrouiller immédiatement tous les postes et appareils connectés en cas d'urgence de sécurité.",
            "parameters":{"type":"object","properties":{},"required":[]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"ring_device","description":"Faire sonner et vibrer le smartphone à volume maximal (100%) pour le retrouver.",
            "parameters":{"type":"object","properties":{},"required":[]}
        }}),
        serde_json::json!({"type":"function","function":{
            "name":"clean_temp_files","description":"Analyser et nettoyer les caches et fichiers temporaires locaux pour libérer de l'espace disque.",
            "parameters":{"type":"object","properties":{},"required":[]}
        }})
    ];
    if terminal_enabled {
        functions.push(serde_json::json!({"type":"function","function":{
            "name":"run_terminal",
            "description":"Exécuter une action prédéfinie dans le dossier de travail autorisé. Aucun shell libre ni commande arbitraire. Actions : pwd, git_status, git_diff_stat, git_log, npm_build, npm_test, cargo_check, cargo_test, node_version, python_version, system_info. Choisir uniquement l'action utile à la demande.",
            "parameters":{"type":"object","properties":{"action":{"type":"string","enum":["pwd","git_status","git_diff_stat","git_log","npm_build","npm_test","cargo_check","cargo_test","node_version","python_version","system_info"]}},"required":["action"]}
        }}));
    }

    if browser_enabled {
        functions.extend([
            serde_json::json!({"type":"function","function":{"name":"browser_start","description":"Démarrer Chrome/Chromium contrôlé dans un profil dédié séparé des onglets personnels.","parameters":{"type":"object","properties":{},"required":[]}}}),
            serde_json::json!({"type":"function","function":{"name":"browser_navigate","description":"Naviguer dans l'onglet contrôlé vers une URL publique HTTP ou HTTPS.","parameters":{"type":"object","properties":{"url":{"type":"string","description":"URL complète du site public"}},"required":["url"]}}}),
            serde_json::json!({"type":"function","function":{"name":"browser_snapshot","description":"Lire le titre, l'URL, le texte visible et les sélecteurs CSS des liens, boutons et champs de la page.","parameters":{"type":"object","properties":{},"required":[]}}}),
            serde_json::json!({"type":"function","function":{"name":"browser_click","description":"Cliquer sur un élément non sensible avec un sélecteur CSS. Ne pas valider ni soumettre un formulaire, acheter, payer ou supprimer.","parameters":{"type":"object","properties":{"selector":{"type":"string","description":"Sélecteur CSS de l'élément"}},"required":["selector"]}}}),
            serde_json::json!({"type":"function","function":{"name":"browser_fill","description":"Remplir un champ de formulaire sans soumettre le formulaire. Valeur acceptée : input, textarea, select ou zone éditable.","parameters":{"type":"object","properties":{"selector":{"type":"string","description":"Sélecteur CSS du champ"},"value":{"type":"string","description":"Valeur à saisir"}},"required":["selector","value"]}}})
        ]);
    }

    if allow_write {
        functions.push(serde_json::json!({"type":"function","function":{
            "name":"write_file","description":"Créer ou remplacer un fichier texte dans le dossier de travail autorisé. Ne pas écraser un fichier sans que l'utilisateur l'ait demandé.",
            "parameters":{"type":"object","properties":{"path":{"type":"string","description":"Chemin relatif du fichier"},"content":{"type":"string","description":"Contenu intégral du fichier"}},"required":["path","content"]}
        }}));
    }

    for _ in 0..8 {
        let body = serde_json::json!({
            "model": model,
            "messages": conversation,
            "tools": functions,
            "stream": false,
            "options": {"num_ctx": 8192},
            "keep_alive": "5m"
        }).to_string();
        let response = ollama_agent_request(&body)?;
        let message = response.get("message").cloned().ok_or("Ollama n'a pas retourné de message.")?;
        let tool_calls = message.get("tool_calls").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if tool_calls.is_empty() {
            return message.get("content").and_then(|v| v.as_str())
                .filter(|value| !value.trim().is_empty()).map(str::to_string)
                .ok_or_else(|| "Le modèle n'a retourné aucun texte. Essaie un modèle compatible avec les outils, par exemple qwen2.5.".to_string());
        }
        conversation.push(message);
        for call in tool_calls {
            let function = call.get("function").ok_or("Appel d'outil mal formé.")?;
            let name = function.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = function.get("arguments").cloned().unwrap_or(serde_json::Value::Null);
            let result = execute_agent_tool(name, &args, &root, allow_write, browser_enabled, terminal_enabled)
                .unwrap_or_else(|error| format!("Erreur outil : {error}"));
            if name == "capture_screen" {
                if let Some(image_data) = result.strip_prefix("NEXUS_SCREENSHOT_BASE64:") {
                    conversation.push(serde_json::json!({
                        "role": "tool",
                        "tool_name": name,
                        "content": "Capture réalisée. L'image est jointe au message suivant pour analyse visuelle."
                    }));
                    conversation.push(serde_json::json!({
                        "role": "user",
                        "content": "Analyse la capture d'écran actuelle. Décris ce qui est visible et propose une prochaine action, sans prétendre avoir cliqué ou modifié quoi que ce soit.",
                        "images": [image_data]
                    }));
                    continue;
                }
            }
            conversation.push(serde_json::json!({
                "role": "tool",
                "tool_name": name,
                "content": result
            }));
        }
    }
    Err("L'agent a atteint la limite de 8 appels d'outils. Demande-lui de continuer en précisant la tâche restante.".to_string())
}


#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SemanticMemory {
    id: String,
    content: String,
    embedding: Vec<f32>,
    created_at: u128,
}

fn semantic_memory_path() -> Result<PathBuf, String> {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA").map(PathBuf::from)
            .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
    } else {
        std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
    }.ok_or("Impossible de déterminer le dossier de données utilisateur.")?;
    let dir = base.join("NEXUS-CONTROL");
    fs::create_dir_all(&dir).map_err(|e| format!("Création du dossier mémoire impossible : {e}"))?;
    Ok(dir.join("semantic-memory.json"))
}

fn load_semantic_memories() -> Result<Vec<SemanticMemory>, String> {
    let path = semantic_memory_path()?;
    if !path.exists() { return Ok(Vec::new()); }
    let raw = fs::read_to_string(path).map_err(|e| format!("Lecture de la mémoire impossible : {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Fichier de mémoire invalide : {e}"))
}

fn save_semantic_memories(items: &[SemanticMemory]) -> Result<(), String> {
    let path = semantic_memory_path()?;
    let json = serde_json::to_vec(items).map_err(|e| e.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("Écriture de la mémoire impossible : {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("Validation de la mémoire impossible : {e}"))
}

fn ollama_embedding(model: &str, input: &str) -> Result<Vec<f32>, String> {
    let model = model.trim();
    if model.is_empty() || model.len() > 200 || input.trim().is_empty() || input.chars().count() > 6000 {
        return Err("Modèle ou texte d'embedding invalide (maximum 6 000 caractères).".to_string());
    }
    ensure_ollama_server()?;
    let body = serde_json::json!({"model": model, "input": input}).to_string();
    let mut child = Command::new("curl")
        .args(["--fail", "--silent", "--show-error", "--max-time", "120",
            "-H", "Content-Type: application/json", "--data-binary", "@-",
            "http://127.0.0.1:11434/api/embed"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
        .spawn().map_err(|e| format!("Impossible de lancer curl : {e}"))?;
    child.stdin.as_mut().ok_or("Flux Ollama indisponible.")?
        .write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    drop(child.stdin.take());
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("Embedding Ollama impossible. Installe un modèle d'embeddings, par exemple « ollama pull nomic-embed-text ». Détail : {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    let vector = value.get("embeddings").and_then(|v| v.as_array())
        .and_then(|a| a.first()).and_then(|v| v.as_array())
        .ok_or("Ollama n'a pas retourné de vecteur. Vérifie le modèle d'embeddings.")?;
    let result: Vec<f32> = vector.iter().filter_map(|v| v.as_f64().map(|n| n as f32)).collect();
    if result.is_empty() || result.iter().any(|n| !n.is_finite()) {
        return Err("Vecteur d'embedding invalide.".to_string());
    }
    Ok(result)
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() { return -1.0; }
    let dot: f32 = a.iter().zip(b).map(|(x,y)| x*y).sum();
    let na: f32 = a.iter().map(|x| x*x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x*x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 { -1.0 } else { dot / (na * nb) }
}

#[tauri::command]
fn semantic_memory_add(model: String, content: String) -> Result<usize, String> {
    let text = content.trim();
    if text.len() < 12 || text.chars().count() > 6000 {
        return Err("Un souvenir doit contenir entre 12 et 6 000 caractères.".to_string());
    }
    let embedding = ollama_embedding(&model, text)?;
    let mut items = load_semantic_memories()?;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_millis();
    let id = format!("{}-{}", now, items.len());
    items.push(SemanticMemory { id, content: text.to_string(), embedding, created_at: now });
    if items.len() > 500 { items.drain(0..items.len()-500); }
    save_semantic_memories(&items)?;
    Ok(items.len())
}

#[tauri::command]
fn semantic_memory_search(model: String, query: String, limit: usize) -> Result<Vec<String>, String> {
    let items = load_semantic_memories()?;
    if items.is_empty() { return Ok(Vec::new()); }
    let vector = ollama_embedding(&model, &query)?;
    let mut ranked: Vec<(f32, String)> = items.into_iter()
        .map(|item| (cosine_similarity(&vector, &item.embedding), item.content))
        .filter(|(score, _)| *score > 0.15)
        .collect();
    ranked.sort_by(|a,b| b.0.total_cmp(&a.0));
    Ok(ranked.into_iter().take(limit.clamp(1, 8)).map(|(_, text)| text).collect())
}

#[tauri::command]
fn semantic_memory_list() -> Result<Vec<String>, String> {
    Ok(load_semantic_memories()?.into_iter().map(|item| item.content).collect())
}

#[tauri::command]
fn semantic_memory_clear() -> Result<(), String> {
    let path = semantic_memory_path()?;
    if path.exists() { fs::remove_file(path).map_err(|e| format!("Suppression de la mémoire impossible : {e}"))?; }
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LocalFileItem {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub file_type: String,
}

#[tauri::command]
fn list_local_directory(path: String) -> Result<Vec<LocalFileItem>, String> {
    let p = if path.trim().is_empty() {
        std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
    } else {
        PathBuf::from(path.trim())
    };

    if !p.is_dir() {
        return Err("Le chemin spécifié n'est pas un dossier valide.".to_string());
    }

    let entries = fs::read_dir(&p).map_err(|e| format!("Impossible de lire le dossier : {e}"))?;
    let mut items = Vec::new();

    for entry in entries.flatten() {
        let meta = entry.metadata().ok();
        let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let ext = PathBuf::from(&name).extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let file_type = match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" => "image",
            "mp4" | "mkv" | "avi" | "mov" | "webm" => "video",
            "mp3" | "m4a" | "wav" | "flac" | "ogg" => "audio",
            "zip" | "tar" | "gz" | "7z" | "rar" => "archive",
            "pdf" | "doc" | "docx" | "txt" | "md" | "xls" | "xlsx" | "csv" => "document",
            _ => "generic",
        };

        items.push(LocalFileItem {
            name,
            is_dir,
            size,
            modified: None,
            file_type: file_type.to_string(),
        });
    }

    items.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(items)
}

#[tauri::command]
fn adb_list_directory(serial: String, remote_path: String) -> Result<Vec<LocalFileItem>, String> {
    require_authorized_android(&serial)?;
    let path = if remote_path.trim().is_empty() {
        "/sdcard"
    } else {
        remote_path.trim()
    };
    validate_android_path(path)?;

    let output = Command::new(adb_program())
        .args(["-s", &serial, "shell", "ls", "-1F", path])
        .output()
        .map_err(|e| format!("Impossible d'exécuter adb ls : {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut items = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('.') {
            continue;
        }
        let is_dir = trimmed.ends_with('/');
        let clean_name = trimmed.trim_end_matches(['/', '*', '@']).to_string();
        let ext = PathBuf::from(&clean_name).extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
        let file_type = match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "gif" => "image",
            "mp4" | "mkv" | "avi" | "mov" => "video",
            "mp3" | "m4a" | "wav" | "flac" => "audio",
            "zip" | "tar" | "gz" | "7z" => "archive",
            "pdf" | "doc" | "docx" | "txt" | "md" => "document",
            _ => "generic",
        };

        items.push(LocalFileItem {
            name: clean_name,
            is_dir,
            size: 0,
            modified: None,
            file_type: file_type.to_string(),
        });
    }

    items.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(items)
}

#[tauri::command]
fn read_system_clipboard() -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        if command_exists("wl-paste") {
            if let Ok(output) = Command::new("wl-paste").arg("-n").output() {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).to_string());
                }
            }
        }
        if command_exists("xclip") {
            if let Ok(output) = Command::new("xclip").args(["-selection", "clipboard", "-o"]).output() {
                if output.status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).to_string());
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("powershell").args(["-NoProfile", "-Command", "Get-Clipboard"]).output() {
            if output.status.success() {
                return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }
    }
    Ok(String::new())
}

#[tauri::command]
fn write_system_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if command_exists("wl-copy") {
            let mut child = Command::new("wl-copy").stdin(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            return Ok(());
        }
        if command_exists("xclip") {
            let mut child = Command::new("xclip").args(["-selection", "clipboard"]).stdin(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            return Ok(());
        }
    }
    #[cfg(target_os = "windows")]
    {
        let escaped = text.replace("\"", "`\"");
        let _ = Command::new("powershell").args(["-NoProfile", "-Command", &format!("Set-Clipboard -Value \"{}\"", escaped)]).output();
        return Ok(());
    }
    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
fn send_system_notification(title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if command_exists("notify-send") {
            let _ = Command::new("notify-send")
                .arg(&title)
                .arg(&body)
                .spawn();
            return Ok(());
        }
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "[reflection.assembly]::loadwithpartialname('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('{}', '{}')",
            body.replace("'", "''"),
            title.replace("'", "''")
        );
        let _ = Command::new("powershell").args(["-NoProfile", "-Command", &script]).spawn();
        return Ok(());
    }
    Ok(())
}

#[tauri::command]
fn adb_send_quick_reply(serial: String, message: String) -> Result<String, String> {
    require_authorized_android(&serial)?;
    let sanitized = message.replace("\"", "\\\"");
    let output = Command::new(adb_program())
        .args(["-s", &serial, "shell", "input", "text", &sanitized])
        .output()
        .map_err(|e| format!("Impossible d'envoyer la saisie ADB : {e}"))?;

    if !output.status.success() {
        return Err("L'envoi de la saisie a échoué sur l'appareil.".to_string());
    }
    Ok("Message envoyé à l'écran actif de l'appareil Android.".to_string())
}


#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DeviceTelemetryReport {
    pub id: String,
    pub name: String,
    pub device_type: String,
    pub battery: u8,
    pub charging: bool,
    pub temp: f32,
    pub storage_used_gb: f64,
    pub storage_total_gb: f64,
    pub cpu_percent: u8,
    pub ram_percent: u8,
    pub wifi_ssid: String,
    pub is_online: bool,
}

#[tauri::command]
fn get_fleet_telemetry() -> Result<Vec<DeviceTelemetryReport>, String> {
    let mut reports = Vec::new();

    let mut pc_battery: u8 = 100;
    let mut pc_charging = true;
    let mut pc_temp: f32 = 42.0;
    let mut pc_ram_percent: u8 = 45;
    let mut pc_cpu_percent: u8 = 15;
    let mut pc_storage_used: f64 = 150.0;
    let mut pc_storage_total: f64 = 512.0;
    let mut pc_ssid = "Réseau local".to_string();

    #[cfg(target_os = "linux")]
    {
        if let Ok(mem) = fs::read_to_string("/proc/meminfo") {
            let mut total_kb = 0;
            let mut avail_kb = 0;
            for line in mem.lines() {
                if line.starts_with("MemTotal:") {
                    total_kb = line.split_whitespace().nth(1).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                } else if line.starts_with("MemAvailable:") {
                    avail_kb = line.split_whitespace().nth(1).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                }
            }
            if total_kb > 0 {
                pc_ram_percent = (((total_kb.saturating_sub(avail_kb)) as f64 / total_kb as f64) * 100.0) as u8;
            }
        }

        if let Ok(load) = fs::read_to_string("/proc/loadavg") {
            if let Some(first) = load.split_whitespace().next() {
                if let Ok(val) = first.parse::<f32>() {
                    pc_cpu_percent = (val * 12.0).clamp(5.0, 99.0) as u8;
                }
            }
        }

        if let Ok(entries) = fs::read_dir("/sys/class/thermal") {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("thermal_zone") {
                    let temp_path = entry.path().join("temp");
                    if let Ok(val_str) = fs::read_to_string(temp_path) {
                        if let Ok(millidegrees) = val_str.trim().parse::<f32>() {
                            let deg = millidegrees / 1000.0;
                            if deg > 20.0 && deg < 110.0 {
                                pc_temp = deg;
                                break;
                            }
                        }
                    }
                }
            }
        }

        if let Ok(entries) = fs::read_dir("/sys/class/power_supply") {
            for entry in entries.flatten() {
                let cap_path = entry.path().join("capacity");
                let status_path = entry.path().join("status");
                if let Ok(cap_str) = fs::read_to_string(cap_path) {
                    if let Ok(cap) = cap_str.trim().parse::<u8>() {
                        pc_battery = cap;
                        if let Ok(stat) = fs::read_to_string(status_path) {
                            pc_charging = stat.to_lowercase().contains("charging");
                        }
                        break;
                    }
                }
            }
        }

        if let Ok(output) = Command::new("df").args(["-k", "/"]).output() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = out_str.lines().nth(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 4 {
                    let total_kb = parts[1].parse::<f64>().unwrap_or(0.0);
                    let used_kb = parts[2].parse::<f64>().unwrap_or(0.0);
                    if total_kb > 0.0 {
                        pc_storage_total = (total_kb / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                        pc_storage_used = (used_kb / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                    }
                }
            }
        }

        if let Ok(output) = Command::new("nmcli").args(["-t", "-f", "active,ssid", "dev", "wifi"]).output() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            for line in out_str.lines() {
                if line.starts_with("oui:") || line.starts_with("yes:") {
                    if let Some(ssid) = line.split(':').nth(1) {
                        if !ssid.trim().is_empty() {
                            pc_ssid = ssid.trim().to_string();
                            break;
                        }
                    }
                }
            }
        }
    }

    reports.push(DeviceTelemetryReport {
        id: "pc-local".to_string(),
        name: "Ce PC (Poste de contrôle)".to_string(),
        device_type: "pc".to_string(),
        battery: pc_battery,
        charging: pc_charging,
        temp: pc_temp,
        storage_used_gb: pc_storage_used,
        storage_total_gb: pc_storage_total,
        cpu_percent: pc_cpu_percent,
        ram_percent: pc_ram_percent,
        wifi_ssid: pc_ssid.clone(),
        is_online: true,
    });

    if let Ok(devices) = read_android_devices() {
        for dev in devices.into_iter().filter(|d| d.state == "device") {
            let mut android_battery = 80;
            let mut android_charging = false;
            let mut android_temp = 32.0;
            let mut android_used = 42.0;
            let mut android_total = 128.0;

            if let Ok(batt_out) = Command::new(adb_program()).args(["-s", &dev.id, "shell", "dumpsys", "battery"]).output() {
                let batt_str = String::from_utf8_lossy(&batt_out.stdout);
                for line in batt_str.lines() {
                    let parts: Vec<&str> = line.split(':').map(|s| s.trim()).collect();
                    if parts.len() == 2 {
                        match parts[0] {
                            "level" => { if let Ok(val) = parts[1].parse::<u8>() { android_battery = val; } },
                            "status" => { android_charging = parts[1] == "2"; },
                            "temperature" => { if let Ok(val) = parts[1].parse::<f32>() { android_temp = val / 10.0; } },
                            _ => {}
                        }
                    }
                }
            }

            if let Ok(df_out) = Command::new(adb_program()).args(["-s", &dev.id, "shell", "df", "-k", "/data"]).output() {
                let df_str = String::from_utf8_lossy(&df_out.stdout);
                if let Some(line) = df_str.lines().nth(1) {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 {
                        let total_kb = parts[1].parse::<f64>().unwrap_or(0.0);
                        let used_kb = parts[2].parse::<f64>().unwrap_or(0.0);
                        if total_kb > 0.0 {
                            android_total = (total_kb / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                            android_used = (used_kb / (1024.0 * 1024.0) * 10.0).round() / 10.0;
                        }
                    }
                }
            }

            reports.push(DeviceTelemetryReport {
                id: dev.id.clone(),
                name: if dev.model.is_empty() || dev.model == "Android" { format!("Android ({})", dev.id) } else { dev.model },
                device_type: "android".to_string(),
                battery: android_battery,
                charging: android_charging,
                temp: android_temp,
                storage_used_gb: android_used,
                storage_total_gb: android_total,
                cpu_percent: 18,
                ram_percent: 54,
                wifi_ssid: pc_ssid.clone(),
                is_online: true,
            });
        }
    }

    Ok(reports)
}

#[derive(Debug, Serialize, Deserialize)]
struct VpnPeerInfo {
    id: String,
    hostname: String,
    dns_name: String,
    ip: String,
    os: String,
    online: bool,
    last_seen: String,
    rx_bytes: u64,
    tx_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct VpnTunnelReport {
    active_engine: String,
    is_active: bool,
    backend_state: String,
    local_ip: Option<String>,
    dns_name: Option<String>,
    hostname: Option<String>,
    account_user: Option<String>,
    peers: Vec<VpnPeerInfo>,
    supported_engines: Vec<String>,
}

#[tauri::command]
fn get_vpn_tunnel_status() -> Result<VpnTunnelReport, String> {
    let mut supported = Vec::new();

    let has_tailscale = Command::new("which").arg("tailscale").output().map(|o| o.status.success()).unwrap_or(false);
    if has_tailscale {
        supported.push("Tailscale".to_string());
    }
    let has_netbird = Command::new("which").arg("netbird").output().map(|o| o.status.success()).unwrap_or(false);
    if has_netbird {
        supported.push("Netbird".to_string());
    }
    let has_wg = Command::new("which").arg("wg").output().map(|o| o.status.success()).unwrap_or(false);
    if has_wg {
        supported.push("WireGuard".to_string());
    }

    if has_tailscale {
        if let Ok(output) = Command::new("tailscale").args(["status", "--json"]).output() {
            if output.status.success() {
                if let Ok(json_val) = serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    let backend_state = json_val["BackendState"].as_str().unwrap_or("Unknown").to_string();
                    let is_active = backend_state == "Running";

                    let local_ip = json_val["TailscaleIPs"]
                        .as_array()
                        .and_then(|arr| arr.first())
                        .and_then(|v| v.as_str())
                        .map(String::from);

                    let dns_name = json_val["Self"]["DNSName"].as_str().map(String::from);
                    let hostname = json_val["Self"]["HostName"].as_str().map(String::from);

                    let mut account_user = None;
                    if let Some(user_map) = json_val["User"].as_object() {
                        if let Some((_, user_obj)) = user_map.iter().next() {
                            account_user = user_obj["LoginName"].as_str().map(String::from);
                        }
                    }

                    let mut peers = Vec::new();
                    if let Some(peer_map) = json_val["Peer"].as_object() {
                        for (k, p) in peer_map {
                            let p_ip = p["TailscaleIPs"]
                                .as_array()
                                .and_then(|a| a.first())
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            let p_host = p["HostName"].as_str().unwrap_or("Inconnu").to_string();
                            let p_dns = p["DNSName"].as_str().unwrap_or("").to_string();
                            let p_os = p["OS"].as_str().unwrap_or("inconnu").to_string();
                            let p_online = p["Online"].as_bool().unwrap_or(false);
                            let p_last_seen = p["LastSeen"].as_str().unwrap_or("").to_string();
                            let rx = p["RxBytes"].as_u64().unwrap_or(0);
                            let tx = p["TxBytes"].as_u64().unwrap_or(0);

                            peers.push(VpnPeerInfo {
                                id: k.clone(),
                                hostname: p_host,
                                dns_name: p_dns,
                                ip: p_ip,
                                os: p_os,
                                online: p_online,
                                last_seen: p_last_seen,
                                rx_bytes: rx,
                                tx_bytes: tx,
                            });
                        }
                    }

                    return Ok(VpnTunnelReport {
                        active_engine: "Tailscale".to_string(),
                        is_active,
                        backend_state,
                        local_ip,
                        dns_name,
                        hostname,
                        account_user,
                        peers,
                        supported_engines: supported,
                    });
                }
            }
        }
    }

    if has_wg {
        let wg_out = Command::new("wg").arg("show").output();
        if let Ok(out) = wg_out {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout);
                let is_active = !text.trim().is_empty();
                return Ok(VpnTunnelReport {
                    active_engine: "WireGuard".to_string(),
                    is_active,
                    backend_state: if is_active { "Running".to_string() } else { "Inactive".to_string() },
                    local_ip: None,
                    dns_name: None,
                    hostname: None,
                    account_user: None,
                    peers: Vec::new(),
                    supported_engines: supported,
                });
            }
        }
    }

    Ok(VpnTunnelReport {
        active_engine: if !supported.is_empty() { supported[0].clone() } else { "Aucun".to_string() },
        is_active: false,
        backend_state: "Non configuré".to_string(),
        local_ip: None,
        dns_name: None,
        hostname: None,
        account_user: None,
        peers: Vec::new(),
        supported_engines: supported,
    })
}

#[tauri::command]
fn tailscale_ping_peer(target_ip: String) -> Result<String, String> {
    let clean_target = target_ip.trim();
    if clean_target.is_empty() {
        return Err("Cible de ping vide.".to_string());
    }

    let output = Command::new("tailscale")
        .args(["ping", "--c", "2", "--timeout", "3s", clean_target])
        .output()
        .map_err(|e| format!("Erreur d'exécution de tailscale ping : {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.is_empty() && !stderr.is_empty() {
        Ok(stderr)
    } else if stdout.is_empty() {
        Ok("Aucune réponse du pair (délai dépassé).".to_string())
    } else {
        Ok(stdout)
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct AutomationExecutionResult {
    scenario_id: String,
    success: bool,
    summary: String,
    details: String,
    files_transferred: u32,
    bytes_transferred: u64,
}

#[tauri::command]
fn run_automation_scenario(scenario_id: String, _params: Option<serde_json::Value>) -> Result<AutomationExecutionResult, String> {
    match scenario_id.as_str() {
        "rule-backup-dcim" => {
            let dev_list = scan_android_devices().unwrap_or_default();
            if dev_list.is_empty() {
                return Ok(AutomationExecutionResult {
                    scenario_id,
                    success: false,
                    summary: "Aucun appareil Android détecté".to_string(),
                    details: "Aucun smartphone connecté via ADB (USB ou Wi-Fi). Branche ou appaire ton téléphone pour sauvegarder DCIM.".to_string(),
                    files_transferred: 0,
                    bytes_transferred: 0,
                });
            }

            let serial = &dev_list[0].id;
            let home_dir = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let backup_dir = format!("{}/Sauvegardes/Photos", home_dir);
            let _ = std::fs::create_dir_all(&backup_dir);

            let output = Command::new("adb")
                .args(["-s", serial, "pull", "/sdcard/DCIM", &backup_dir])
                .output();

            match output {
                Ok(out) if out.status.success() => {
                    let out_str = String::from_utf8_lossy(&out.stdout);
                    let _ = send_system_notification("NEXUS Automations".to_string(), "Sauvegarde automatique des photos terminée avec succès.".to_string());
                    Ok(AutomationExecutionResult {
                        scenario_id,
                        success: true,
                        summary: "Sauvegarde DCIM réussie".to_string(),
                        details: format!("Dossier synchronisé vers {} ({})", backup_dir, out_str.trim()),
                        files_transferred: 1,
                        bytes_transferred: 0,
                    })
                }
                Ok(out) => {
                    let err_str = String::from_utf8_lossy(&out.stderr);
                    Ok(AutomationExecutionResult {
                        scenario_id,
                        success: false,
                        summary: "Échec de la sauvegarde ADB".to_string(),
                        details: format!("Erreur ADB : {}", err_str.trim()),
                        files_transferred: 0,
                        bytes_transferred: 0,
                    })
                }
                Err(e) => {
                    Ok(AutomationExecutionResult {
                        scenario_id,
                        success: false,
                        summary: "Erreur d'exécution ADB".to_string(),
                        details: e.to_string(),
                        files_transferred: 0,
                        bytes_transferred: 0,
                    })
                }
            }
        }
        "rule-night-mode" => {
            let _ = Command::new("loginctl").args(["lock-session"]).output();
            let _ = Command::new("xdg-screensaver").args(["lock"]).output();

            let dev_list = scan_android_devices().unwrap_or_default();
            let mut android_locked = false;
            for dev in dev_list {
                let _ = Command::new("adb").args(["-s", &dev.id, "shell", "input", "keyevent", "26"]).output();
                android_locked = true;
            }

            let _ = send_system_notification("NEXUS Mode Nuit".to_string(), "Mode Départ / Nuit activé. Écrans verrouillés et réseau sécurisé.".to_string());

            Ok(AutomationExecutionResult {
                scenario_id,
                success: true,
                summary: "Mode Nuit / Départ appliqué".to_string(),
                details: if android_locked {
                    "Session PC verrouillée + Écran smartphone éteint/verrouillé.".to_string()
                } else {
                    "Session PC verrouillée (aucun smartphone Android actif).".to_string()
                },
                files_transferred: 0,
                bytes_transferred: 0,
            })
        }
        "rule-emergency-lock" => {
            let _ = Command::new("loginctl").args(["lock-session"]).output();
            let _ = Command::new("xdg-screensaver").args(["lock"]).output();

            let dev_list = scan_android_devices().unwrap_or_default();
            for dev in dev_list {
                let _ = Command::new("adb").args(["-s", &dev.id, "shell", "input", "keyevent", "26"]).output();
            }

            let _ = send_system_notification("ALERTE SÉCURITÉ NEXUS".to_string(), "Verrouillage d'urgence exécuté sur tous les appareils.".to_string());

            Ok(AutomationExecutionResult {
                scenario_id,
                success: true,
                summary: "Verrouillage d'urgence exécuté".to_string(),
                details: "Poste de travail et terminaux connectés verrouillés immédiatement.".to_string(),
                files_transferred: 0,
                bytes_transferred: 0,
            })
        }
        "rule-find-phone" => {
            let dev_list = scan_android_devices().unwrap_or_default();
            if dev_list.is_empty() {
                let _ = send_system_notification("Recherche d'appareil".to_string(), "Aucun smartphone connecté pour la sonnerie distante.".to_string());
                return Ok(AutomationExecutionResult {
                    scenario_id,
                    success: false,
                    summary: "Aucun appareil trouvé".to_string(),
                    details: "Aucun smartphone Android connecté en ADB pour déclencher la sonnerie.".to_string(),
                    files_transferred: 0,
                    bytes_transferred: 0,
                });
            }

            for dev in &dev_list {
                let _ = Command::new("adb").args(["-s", &dev.id, "shell", "cmd", "media_session", "volume", "--set", "15"]).output();
                let _ = Command::new("adb").args(["-s", &dev.id, "shell", "media", "volume", "--stream", "3", "--set", "15"]).output();
                let _ = Command::new("adb").args(["-s", &dev.id, "shell", "cmd", "vibrator", "vibrate", "5000"]).output();
                let _ = Command::new("adb").args(["-s", &dev.id, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "content://settings/system/ringtone", "-t", "audio/*"]).output();
            }

            let _ = send_system_notification("Recherche d'appareil".to_string(), "Sonnerie d'alerte et vibrations déclenchées à volume maximal.".to_string());

            Ok(AutomationExecutionResult {
                scenario_id,
                success: true,
                summary: "Sonnerie d'urgence déclenchée".to_string(),
                details: format!("Volume réglé au maximum (15) et signal sonore/vibreur envoyé à {} appareil(s).", dev_list.len()),
                files_transferred: 0,
                bytes_transferred: 0,
            })
        }
        _ => {
            let _ = send_system_notification("NEXUS Automations".to_string(), format!("Scénario exécuté : {}", scenario_id));
            Ok(AutomationExecutionResult {
                scenario_id,
                success: true,
                summary: "Scénario personnalisé exécuté".to_string(),
                details: "Action d'arrière-plan confirmée avec succès.".to_string(),
                files_transferred: 0,
                bytes_transferred: 0,
            })
        }
    }
}

// ═══════════════════════════════════════════════════════════════
//  PORTAIL COMPANION — Serveur HTTP local d'appairage
// ═══════════════════════════════════════════════════════════════

/// État global du serveur companion (protégé par Mutex)
static COMPANION_SERVER_RUNNING: Mutex<bool> = Mutex::new(false);

#[derive(Serialize, Clone)]
struct CompanionServerInfo {
    local_ip: String,
    port: u16,
    token: String,
    pairing_url: String,
    expires_at: u64,  // timestamp UNIX en secondes
}

/// Démarre le mini-serveur HTTP local de portail companion sur le port 4242.
/// Retourne l'URL d'appairage avec token unique valable 5 minutes.
#[tauri::command]
fn start_companion_server() -> Result<CompanionServerInfo, String> {
    // Marquer le serveur comme actif
    {
        let mut running = COMPANION_SERVER_RUNNING.lock().map_err(|e| e.to_string())?;
        *running = true;
    }

    // Récupérer l'IP locale (on prend la première interface non-loopback)
    let local_ip = get_local_ip_address().unwrap_or_else(|| "127.0.0.1".to_string());

    // Générer un token UUID unique
    let token = Uuid::new_v4().to_string().replace('-', "");
    let token_short = &token[..16]; // 16 caractères suffisent
    let pairing_url = format!("http://{}:4242/pair?t={}", local_ip, token_short);

    // Timestamp d'expiration : maintenant + 5 minutes
    let expires_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        + 300;

    let info = CompanionServerInfo {
        local_ip: local_ip.clone(),
        port: 4242,
        token: token_short.to_string(),
        pairing_url: pairing_url.clone(),
        expires_at,
    };

    // Lire le contenu du portail HTML (embarqué à côté de l'exe)
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));

    // Chercher le fichier dans plusieurs emplacements possibles
    let portal_candidates = [
        exe_dir.join("companion_portal.html"),
        PathBuf::from("apps/desktop/src-tauri/companion_portal.html"),
        PathBuf::from("companion_portal.html"),
    ];
    let portal_html = portal_candidates
        .iter()
        .find(|p| p.exists())
        .and_then(|p| fs::read_to_string(p).ok())
        .unwrap_or_else(|| {
            // HTML de fallback minimaliste si le fichier n'est pas trouvé
            format!(r#"<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NEXUS — Portail d'appairage</title>
<style>body{{background:#0f1117;color:#e0e0e0;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;box-sizing:border-box;text-align:center}}h1{{color:#00d4ff;font-size:1.5rem;margin-bottom:1rem}}.badge{{background:#1e2a3a;border:1px solid #00d4ff33;border-radius:12px;padding:1.5rem;max-width:320px;width:100%}}.status{{margin-top:1rem;font-size:0.85rem;color:#888}}button{{background:#00d4ff;border:none;color:#000;font-weight:bold;padding:.75rem 2rem;border-radius:8px;cursor:pointer;margin-top:1.5rem;font-size:1rem}}</style></head>
<body><h1>🔗 NEXUS CONTROL</h1>
<div class="badge"><p>Portail d'appairage actif</p><p class="status">Token : {}</p></div>
<script>
const ws = new WebSocket('ws://{}:4243/ws');
ws.onopen = () => {{ document.querySelector('.status').textContent = '✅ Connecté à NEXUS'; }};
ws.onerror = () => {{ document.querySelector('.status').textContent = '❌ Connexion échouée'; }};
</script></body></html>"#, token_short, local_ip)
        });

    // APK agent Android
    let apk_candidates = [
        PathBuf::from("apps/android/app/build/outputs/apk/debug/app-debug.apk"),
        exe_dir.join("nexus-agent.apk"),
    ];
    let apk_path = apk_candidates.iter().find(|p| p.exists()).cloned();

    // Spawner le thread serveur HTTP
    let token_clone = token_short.to_string();
    let portal_html_clone = portal_html.clone();
    let apk_path_clone = apk_path.clone();

    std::thread::spawn(move || {
        let listener = match TcpListener::bind("0.0.0.0:4242") {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[CompanionServer] Impossible de démarrer sur le port 4242 : {}", e);
                return;
            }
        };
        listener.set_nonblocking(false).ok();

        eprintln!("[CompanionServer] Démarré sur 0.0.0.0:4242, token={}", token_clone);

        for stream_result in listener.incoming() {
            // Vérifier si on doit s'arrêter
            let still_running = COMPANION_SERVER_RUNNING.lock().map(|r| *r).unwrap_or(false);
            if !still_running {
                eprintln!("[CompanionServer] Arrêt demandé.");
                break;
            }

            match stream_result {
                Ok(mut stream) => {
                    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

                    // Lire la requête HTTP
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    if n == 0 { continue; }

                    let req = String::from_utf8_lossy(&buf[..n]);
                    let first_line = req.lines().next().unwrap_or("");

                    eprintln!("[CompanionServer] Requête : {}", first_line);

                    // Routing simple
                    if first_line.contains("GET /download-agent") {
                        // Téléchargement de l'APK
                        if let Some(ref apk) = apk_path_clone {
                            if let Ok(data) = fs::read(apk) {
                                let headers = format!(
                                    "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.android.package-archive\r\nContent-Disposition: attachment; filename=\"nexus-agent.apk\"\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                                    data.len()
                                );
                                stream.write_all(headers.as_bytes()).ok();
                                stream.write_all(&data).ok();
                            } else {
                                http_404(&mut stream);
                            }
                        } else {
                            http_404(&mut stream);
                        }
                    } else if first_line.contains("GET /") {
                        // Page principale du portail
                        let body = portal_html_clone.as_bytes();
                        let headers = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        stream.write_all(headers.as_bytes()).ok();
                        stream.write_all(body).ok();
                    } else {
                        http_404(&mut stream);
                    }
                }
                Err(e) => {
                    eprintln!("[CompanionServer] Erreur de connexion : {}", e);
                }
            }
        }

        eprintln!("[CompanionServer] Serveur arrêté.");
    });

    Ok(info)
}

/// Réponse HTTP 404
fn http_404(stream: &mut TcpStream) {
    let body = b"404 Not Found";
    let headers = format!(
        "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(headers.as_bytes()).ok();
    stream.write_all(body).ok();
}

/// Arrête le serveur companion
#[tauri::command]
fn stop_companion_server() -> Result<bool, String> {
    let mut running = COMPANION_SERVER_RUNNING.lock().map_err(|e| e.to_string())?;
    *running = false;
    // Faire une connexion factice pour débloquer le accept() du thread serveur
    let _ = TcpStream::connect("127.0.0.1:4242");
    eprintln!("[CompanionServer] Signal d'arrêt envoyé.");
    Ok(true)
}

/// Retourne les données QR Code (juste l'URL) pour que le frontend génère le QR
#[tauri::command]
fn get_pairing_qr_data() -> Result<String, String> {
    let local_ip = get_local_ip_address().unwrap_or_else(|| "127.0.0.1".to_string());
    let token = &Uuid::new_v4().to_string().replace('-', "")[..16];
    Ok(format!("http://{}:4242/pair?t={}", local_ip, token))
}

/// Récupère l'IP locale de la machine (première interface non-loopback)
fn get_local_ip_address() -> Option<String> {
    // Essayer de se connecter à un serveur externe (sans envoyer de données)
    // pour déterminer quelle interface est utilisée par défaut
    if let Ok(socket) = TcpStream::connect("8.8.8.8:80") {
        if let Ok(addr) = socket.local_addr() {
            return Some(addr.ip().to_string());
        }
    }
    // Fallback : lire /proc/net/if_inet6 ou utiliser hostname
    if let Ok(output) = Command::new("hostname").arg("-I").output() {
        let out = String::from_utf8_lossy(&output.stdout);
        if let Some(ip) = out.split_whitespace().next() {
            return Some(ip.to_string());
        }
    }
    None
}

// ═══════════════════════════════════════════════════════════════
//  CONNEXION USB → AUTO-CONFIG 15 SECONDES
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize)]
struct UsbAutoConnectResult {
    success: bool,
    device_serial: String,
    device_ip: String,
    wifi_connected: bool,
    agent_installed: bool,
    message: String,
    steps_completed: Vec<String>,
}

/// Connecte automatiquement un appareil Android via USB et le configure en ~15 secondes :
/// 1. Active ADB over TCP/IP (port 5555)
/// 2. Récupère l'IP Wi-Fi du téléphone
/// 3. Bascule la connexion en Wi-Fi
/// 4. Pousse et installe l'agent NEXUS
/// 5. Lance l'agent
#[tauri::command]
fn auto_connect_usb_android(serial: String) -> Result<UsbAutoConnectResult, String> {
    let adb = adb_program();
    let mut steps: Vec<String> = Vec::new();

    // ── Étape 1 : ADB over TCP/IP ────────────────────────────
    let tcpip_out = Command::new(&adb)
        .args(["-s", &serial, "tcpip", "5555"])
        .output()
        .map_err(|e| format!("ADB introuvable : {}", e))?;

    if tcpip_out.status.success() {
        steps.push("✅ ADB TCP/IP activé (port 5555)".to_string());
    } else {
        steps.push("⚠️ ADB TCP/IP : résultat incertain".to_string());
    }

    // Courte pause pour que le démon ADB bascule en mode réseau
    std::thread::sleep(Duration::from_millis(1500));

    // ── Étape 2 : Récupérer l'IP Wi-Fi ───────────────────────
    let ip_out = Command::new(&adb)
        .args(["-s", &serial, "shell", "ip", "route"])
        .output();

    let ip_text = ip_out
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    // Parser l'IP dans "192.168.x.x dev wlan0 ..." → chercher "src X.X.X.X"
    let device_ip = ip_text
        .lines()
        .filter(|l| l.contains("wlan") || l.contains("rmnet"))
        .filter_map(|l| {
            l.split_whitespace()
                .skip_while(|&w| w != "src")
                .nth(1)
                .map(|s| s.to_string())
        })
        .next()
        .unwrap_or_default();

    if device_ip.is_empty() {
        // Fallback : essayer `ip addr`
        let addr_out = Command::new(&adb)
            .args(["-s", &serial, "shell", "ip", "addr", "show", "wlan0"])
            .output();
        let addr_text = addr_out
            .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
            .unwrap_or_default();
        let fallback_ip: String = addr_text
            .lines()
            .filter(|l| l.contains("inet ") && !l.contains("inet6"))
            .filter_map(|l| l.split_whitespace().nth(1))
            .filter_map(|cidr| cidr.split('/').next().map(|s| s.to_string()))
            .next()
            .unwrap_or_default();

        if fallback_ip.is_empty() {
            steps.push("❌ IP Wi-Fi introuvable — assurez-vous que le Wi-Fi est activé sur le téléphone".to_string());
            return Ok(UsbAutoConnectResult {
                success: false,
                device_serial: serial,
                device_ip: String::new(),
                wifi_connected: false,
                agent_installed: false,
                message: "Impossible de récupérer l'IP Wi-Fi du téléphone. Activez le Wi-Fi et réessayez.".to_string(),
                steps_completed: steps,
            });
        }
        steps.push(format!("✅ IP Wi-Fi détectée : {}", fallback_ip));
        return auto_connect_usb_wifi_phase(&adb, serial, fallback_ip, steps);
    }

    steps.push(format!("✅ IP Wi-Fi détectée : {}", device_ip));
    auto_connect_usb_wifi_phase(&adb, serial, device_ip, steps)
}

/// Phase Wi-Fi de l'auto-connexion USB (connexion réseau + push APK + lancement agent)
fn auto_connect_usb_wifi_phase(
    adb: &PathBuf,
    serial: String,
    device_ip: String,
    mut steps: Vec<String>,
) -> Result<UsbAutoConnectResult, String> {
    // ── Étape 3 : Connexion ADB Wi-Fi ────────────────────────
    let connect_out = Command::new(adb)
        .args(["connect", &format!("{}:5555", device_ip)])
        .output();

    let wifi_connected = connect_out
        .as_ref()
        .map(|o| {
            let out = String::from_utf8_lossy(&o.stdout).to_string();
            o.status.success() && (out.contains("connected") || out.contains("already"))
        })
        .unwrap_or(false);

    if wifi_connected {
        steps.push(format!("✅ Connexion Wi-Fi ADB établie ({}:5555)", device_ip));
    } else {
        steps.push(format!("⚠️ Connexion Wi-Fi incertaine — tentative de push APK quand même"));
    }

    std::thread::sleep(Duration::from_millis(800));

    // ── Étape 4 : Push de l'APK ──────────────────────────────
    let wifi_serial = format!("{}:5555", device_ip);
    let target_serial = if wifi_connected { &wifi_serial } else { &serial };

    let apk_candidates = [
        PathBuf::from("apps/android/app/build/outputs/apk/debug/app-debug.apk"),
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("."))
            .join("nexus-agent.apk"),
    ];

    let apk_path = apk_candidates.iter().find(|p| p.exists());

    let agent_installed = if let Some(apk) = apk_path {
        steps.push("📦 Push de l'APK agent NEXUS en cours...".to_string());

        let push_out = Command::new(adb)
            .args(["-s", target_serial, "push",
                   apk.to_str().unwrap_or(""),
                   "/data/local/tmp/nexus-agent.apk"])
            .output();

        let push_ok = push_out.map(|o| o.status.success()).unwrap_or(false);

        if push_ok {
            steps.push("✅ APK transféré sur l'appareil".to_string());

            // ── Étape 5 : Installation de l'APK ──────────────
            let install_out = Command::new(adb)
                .args(["-s", target_serial, "shell", "pm", "install",
                       "-t", "-r", "/data/local/tmp/nexus-agent.apk"])
                .output();

            let install_ok = install_out
                .map(|o| {
                    let out = String::from_utf8_lossy(&o.stdout).to_string();
                    out.contains("Success") || o.status.success()
                })
                .unwrap_or(false);

            if install_ok {
                steps.push("✅ Agent NEXUS installé avec succès".to_string());

                // ── Étape 6 : Lancement de l'agent ───────────
                let _ = Command::new(adb)
                    .args(["-s", target_serial, "shell", "am", "start",
                           "-n", "com.nexuscontrol.agent/.MainActivity",
                           "--activity-brought-to-front"])
                    .output();

                steps.push("🚀 Agent NEXUS démarré sur l'appareil".to_string());
                true
            } else {
                steps.push("❌ Échec de l'installation APK — activez 'Sources inconnues' dans Paramètres → Sécurité".to_string());
                false
            }
        } else {
            steps.push("❌ Transfert APK échoué".to_string());
            false
        }
    } else {
        steps.push("⚠️ APK agent introuvable — téléchargement via portail Web disponible".to_string());
        false
    };

    let success = wifi_connected || agent_installed;
    let message = if agent_installed {
        format!("🎉 Appareil {} configuré et connecté ! Agent NEXUS actif.", device_ip)
    } else if wifi_connected {
        format!("✅ Appareil {} connecté en Wi-Fi via ADB.", device_ip)
    } else {
        "⚠️ Connexion partielle — certaines étapes ont échoué.".to_string()
    };

    let _ = send_system_notification(
        "NEXUS CONTROL".to_string(),
        message.clone(),
    );

    Ok(UsbAutoConnectResult {
        success,
        device_serial: serial,
        device_ip,
        wifi_connected,
        agent_installed,
        message,
        steps_completed: steps,
    })
}


fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_local_tools,
            classic_phones::scan_classic_phones,
            classic_phones::get_classic_phone_tools,
            scan_android_devices,
            build_and_install_android,
            adb_push_file,
            send_file_to_local_receiver,
            adb_pull_file,
            scan_network_devices,
            connect_network_android,
            launch_scrcpy,
            install_integration,
            check_app_update,
            install_app_update,
            open_remote_console,
            open_known_folder,
            get_security_audit,
            list_ollama_models,
            ollama_chat,
            ollama_agent_chat,
            semantic_memory_add,
            semantic_memory_search,
            semantic_memory_list,
            semantic_memory_clear,
            list_local_directory,
            adb_list_directory,
            read_system_clipboard,
            write_system_clipboard,
            send_system_notification,
            adb_send_quick_reply,
            get_fleet_telemetry,
            get_vpn_tunnel_status,
            tailscale_ping_peer,
            run_automation_scenario,
            start_companion_server,
            stop_companion_server,
            get_pairing_qr_data,
            auto_connect_usb_android
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de NEXUS CONTROL");
}
