#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{fs, io::{Read, Write, copy}, net::{IpAddr, TcpStream, Shutdown}, path::PathBuf, process::{Command, Stdio}, time::Duration};

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
        let device_type = if ["smart-tv", "smarttv", "television", "android-tv", "roku", "chromecast", "firetv", "tv-", "box"].iter().any(|v| host_lower.contains(v)) {
            "tv"
        } else if ["router", "gateway", "access-point", "access point", "mikrotik", "tp-link", "tplink", "cisco", "netgear"].iter().any(|v| host_lower.contains(v)) {
            "network"
        } else if ["android", "iphone", "ipad", "phone", "mobile", "tecno", "infinix", "itel", "galaxy", "pixel", "redmi", "xiaomi", "oppo", "vivo", "huawei"].iter().any(|v| host_lower.contains(v)) {
            "phone"
        } else if !hostname.is_empty() {
            "computer"
        } else {
            "unknown"
        };
        let kind = match device_type {
            "phone" => "Téléphone / tablette probable",
            "tv" => "Téléviseur / boîtier probable",
            "network" => "Équipement réseau probable",
            "computer" => "Ordinateur probable (nom d'hôte disponible)",
            _ => "Type non identifié",
        }.to_string();
        let os_guess = if device_type == "phone" && lower.contains("android") { "Android probable" }
            else if device_type == "computer" && lower.contains("windows") { "Windows probable" }
            else { "Non déterminé par la découverte sans ports" }.to_string();
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
fn build_and_install_android() -> Result<String, String> {
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
}

fn read_ollama_models() -> Result<Vec<OllamaModel>, String> {
    let output = Command::new("curl")
        .args(["--fail", "--silent", "--show-error", "--max-time", "5", "http://127.0.0.1:11434/api/tags"])
        .output()
        .map_err(|error| format!("Impossible de lancer curl pour contacter Ollama : {error}. Vérifie que curl est installé."))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("Ollama ne répond pas sur 127.0.0.1:11434. Lance « ollama serve » dans un terminal. {detail}"));
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
fn ollama_chat(model: String, messages: Vec<OllamaChatMessage>) -> Result<String, String> {
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
        if message.content.trim().is_empty() || message.content.chars().count() > 12_000 {
            return Err("Chaque message doit contenir du texte et ne pas dépasser 12 000 caractères.".to_string());
        }
        total_chars += message.content.chars().count();
    }
    if total_chars > 50_000 {
        return Err("La conversation est trop longue pour cette requête. Efface l'historique et réessaie.".to_string());
    }

    let installed = read_ollama_models()?;
    if !installed.iter().any(|item| item.name == model) {
        return Err("Ce modèle n'est pas installé dans Ollama. Actualise la liste des modèles.".to_string());
    }

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false
    }).to_string();

    let mut child = Command::new("curl")
        .args([
            "--fail", "--silent", "--show-error", "--max-time", "180",
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_local_tools,
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
            get_security_audit,
            list_ollama_models,
            ollama_chat
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de NEXUS CONTROL");
}
