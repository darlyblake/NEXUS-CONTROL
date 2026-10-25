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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_local_tools,
            scan_android_devices,
            scan_network_devices,
            connect_network_android,
            launch_scrcpy,
            install_integration,
            check_app_update,
            install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("Erreur au lancement de NEXUS CONTROL");
}
