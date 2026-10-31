use serde::Serialize;
use std::{fs, path::Path, process::Command};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassicPhoneDevice {
    pub id: String,
    pub vendor_id: String,
    pub product_id: String,
    pub manufacturer: String,
    pub product: String,
    pub bus: String,
    pub address: String,
    pub brand: String,
    pub likely_phone: bool,
    pub protocols: Vec<String>,
    pub supports_files: bool,
    pub possible_contacts_sms: bool,
    pub maintenance_status: String,
    pub diagnostic: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassicPhoneTool {
    pub id: String,
    pub label: String,
    pub installed: bool,
    pub detail: String,
}

fn read_attr(path: &Path, name: &str) -> String {
    fs::read_to_string(path.join(name))
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

fn detect_brand(manufacturer: &str, product: &str, vendor: &str) -> String {
    let text = format!("{} {}", manufacturer, product).to_lowercase();
    if text.contains("itel") { "itel".into() }
    else if text.contains("nokia") || text.contains("hmd") || vendor == "0421" { "Nokia".into() }
    else if text.contains("tecno") { "TECNO".into() }
    else if text.contains("samsung") || vendor == "04e8" { "Samsung".into() }
    else if text.contains("maxcom") { "Maxcom".into() }
    else if vendor == "1782" { "Unisoc (marque à confirmer)".into() }
    else { "Autre marque / non identifiée".into() }
}

fn interfaces_for(device_name: &str) -> Vec<String> {
    let mut protocols = Vec::new();
    let Ok(entries) = fs::read_dir("/sys/bus/usb/devices") else { return protocols; };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with(&format!("{}:", device_name)) { continue; }
        let path = entry.path();
        let class = read_attr(&path, "bInterfaceClass").to_lowercase();
        let subclass = read_attr(&path, "bInterfaceSubClass").to_lowercase();
        let protocol = read_attr(&path, "bInterfaceProtocol").to_lowercase();
        let description = match class.as_str() {
            "06" if subclass == "01" && protocol == "01" => Some("PTP / MTP (transfert média)"),
            "08" => Some("USB Mass Storage"),
            "02" => Some("Interface de communication USB"),
            "0a" => Some("Interface CDC Data"),
            "ff" => Some("Interface propriétaire constructeur"),
            _ => None,
        };
        if let Some(value) = description {
            if !protocols.iter().any(|item| item == value) {
                protocols.push(value.to_string());
            }
        }
    }
    protocols
}

#[tauri::command]
pub fn scan_classic_phones() -> Result<Vec<ClassicPhoneDevice>, String> {
    #[cfg(not(target_os = "linux"))]
    {
        return Err("La détection USB des téléphones classiques est actuellement disponible uniquement sous Linux.".into());
    }

    #[cfg(target_os = "linux")]
    {
        let root = Path::new("/sys/bus/usb/devices");
        let entries = fs::read_dir(root)
            .map_err(|error| format!("Impossible de lire les périphériques USB Linux : {error}"))?;
        let mut devices = Vec::new();

        for entry in entries.flatten() {
            let path = entry.path();
            let vendor = read_attr(&path, "idVendor").to_lowercase();
            let product_id = read_attr(&path, "idProduct").to_lowercase();
            if vendor.is_empty() || product_id.is_empty() || vendor == "1d6b" { continue; }

            let name = entry.file_name().to_string_lossy().to_string();
            let manufacturer = read_attr(&path, "manufacturer");
            let product = read_attr(&path, "product");
            let bus = read_attr(&path, "busnum");
            let address = read_attr(&path, "devnum");
            let brand = detect_brand(&manufacturer, &product, &vendor);
            let protocols = interfaces_for(&name);
            let supports_files = protocols.iter().any(|item| item.contains("MTP") || item.contains("PTP") || item.contains("Mass Storage"));
            let possible_contacts_sms = protocols.iter().any(|item| item.contains("communication") || item.contains("CDC"));
            let likely_phone = vendor == "1782"
                || format!("{} {}", manufacturer, product).to_lowercase().contains("phone")
                || format!("{} {}", manufacturer, product).to_lowercase().contains("mobile")
                || format!("{} {}", manufacturer, product).to_lowercase().contains("nokia")
                || format!("{} {}", manufacturer, product).to_lowercase().contains("itel")
                || format!("{} {}", manufacturer, product).to_lowercase().contains("tecno")
                || format!("{} {}", manufacturer, product).to_lowercase().contains("samsung")
                || format!("{} {}", manufacturer, product).to_lowercase().contains("maxcom")
                || supports_files || possible_contacts_sms;

            let diagnostic = if protocols.is_empty() {
                "Périphérique USB détecté ; interfaces non exposées par sysfs.".to_string()
            } else {
                format!("Détecté via USB. Interfaces : {}.", protocols.join(", "))
            };

            devices.push(ClassicPhoneDevice {
                id: format!("{}-{}", bus, address),
                vendor_id: vendor,
                product_id,
                manufacturer: if manufacturer.is_empty() { "Non communiqué".into() } else { manufacturer },
                product: if product.is_empty() { "Produit USB non communiqué".into() } else { product },
                bus,
                address,
                brand,
                likely_phone,
                protocols,
                supports_files,
                possible_contacts_sms,
                maintenance_status: "Non vérifiée — firmware et procédure constructeur requis".into(),
                diagnostic,
            });
        }

        devices.sort_by(|a, b| b.likely_phone.cmp(&a.likely_phone).then(a.product.cmp(&b.product)));
        Ok(devices)
    }
}

#[tauri::command]
pub fn get_classic_phone_tools() -> Vec<ClassicPhoneTool> {
    let checks = [
        ("lsusb", "usbutils / lsusb", "Inventaire des périphériques USB"),
        ("udevadm", "udev / udevadm", "Informations et événements USB Linux"),
        ("mtp-detect", "libmtp", "Diagnostic des interfaces MTP compatibles"),
        ("gammu", "Gammu", "SMS, contacts et modem — uniquement sur les modèles/protocoles compatibles"),
        ("adb", "Android Platform Tools", "Diagnostic séparé des appareils Android"),
        ("fastboot", "Fastboot", "Maintenance Android uniquement si le constructeur l'autorise"),
        ("heimdall", "Heimdall", "Outil de flashage Samsung compatible uniquement avec certains modèles"),
        ("spd_dump", "Unisoc / Spreadtrum tools", "Outil spécialisé ; compatibilité et firmware à vérifier"),
    ];
    checks.iter().map(|(id, label, detail)| ClassicPhoneTool {
        id: (*id).to_string(),
        label: (*label).to_string(),
        installed: {
            let finder = if cfg!(target_os = "windows") { "where.exe" } else { "which" };
            Command::new(finder).arg(id).output().map(|output| output.status.success()).unwrap_or(false)
        },
        detail: (*detail).to_string(),
    }).collect()
}


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassicOperationResult { pub ok: bool, pub output: String }

fn run_command(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program).args(args).output().map_err(|e| format!("Impossible de lancer {program} : {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() { return Err(format!("{} a échoué : {}", program, if stderr.trim().is_empty() { stdout } else { stderr })); }
    Ok(if stdout.trim().is_empty() { stderr } else { stdout })
}
fn valid_remote_uri(uri: &str) -> bool { uri.starts_with("mtp://") || uri.starts_with("gphoto2://") }

#[tauri::command]
pub fn classic_mtp_mounts() -> Result<String, String> { run_command("gio", &["mount", "-li"]) }
#[tauri::command]
pub fn classic_mtp_list(uri: String) -> Result<String, String> {
    if !valid_remote_uri(&uri) { return Err("URI refusée : utilise mtp:// ou gphoto2://.".into()); }
    run_command("gio", &["list", "--attributes=standard::name,standard::type,standard::size", &uri])
}
#[tauri::command]
pub fn classic_mtp_copy_from(uri: String, destination: String) -> Result<ClassicOperationResult, String> {
    if !valid_remote_uri(&uri) { return Err("La source doit être une URI MTP ou gphoto2.".into()); }
    if destination.trim().is_empty() { return Err("Chemin de destination local obligatoire.".into()); }
    let output = run_command("gio", &["copy", "--progress", &uri, &destination])?;
    Ok(ClassicOperationResult { ok: true, output })
}
#[tauri::command]
pub fn classic_mtp_copy_to(source: String, uri: String) -> Result<ClassicOperationResult, String> {
    if !valid_remote_uri(&uri) { return Err("La destination doit être une URI MTP ou gphoto2.".into()); }
    if source.trim().is_empty() || !Path::new(&source).is_file() { return Err("Le fichier source local n'existe pas.".into()); }
    let output = run_command("gio", &["copy", "--progress", &source, &uri])?;
    Ok(ClassicOperationResult { ok: true, output })
}

#[tauri::command]
pub fn classic_serial_ports() -> Result<Vec<String>, String> {
    let entries = fs::read_dir("/dev").map_err(|e| format!("Impossible de lire /dev : {e}"))?;
    let mut ports = entries.flatten().filter_map(|entry| {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with("ttyUSB") || name.starts_with("ttyACM") || name.starts_with("ttyS") {
            Some(format!("/dev/{name}"))
        } else { None }
    }).collect::<Vec<_>>();
    ports.sort();
    Ok(ports)
}

fn gammu_config_for(device: &str) -> Result<std::path::PathBuf, String> {
    if !(device.starts_with("/dev/ttyUSB") || device.starts_with("/dev/ttyACM") || device.starts_with("/dev/ttyS")) {
        return Err("Port refusé. Utilise /dev/ttyUSB*, /dev/ttyACM* ou /dev/ttyS*.".into());
    }
    if !Path::new(device).exists() { return Err("Le port série sélectionné n'existe pas.".into()); }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let path = std::env::temp_dir().join(format!("nexus-gammu-{}-{stamp}.ini", std::process::id()));
    fs::write(&path, format!("[gammu]\ndevice = {device}\nconnection = at\n")).map_err(|e| format!("Configuration Gammu impossible : {e}"))?;
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?; }
    Ok(path)
}
fn run_gammu_read(device: &str, args: &[&str]) -> Result<String, String> {
    let config = gammu_config_for(device)?;
    let result = Command::new("gammu").arg("--config").arg(&config).args(args).output().map_err(|e| format!("Gammu indisponible : {e}"));
    let _ = fs::remove_file(&config);
    let output = result?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() { return Err(format!("Gammu n'a pas communiqué avec {device} : {}", if stderr.trim().is_empty() { stdout } else { stderr })); }
    Ok(if stdout.trim().is_empty() { stderr } else { stdout })
}
#[tauri::command]
pub fn classic_gammu_identify(device: String) -> Result<String, String> { run_gammu_read(&device, &["--identify"]) }
#[tauri::command]
pub fn classic_gammu_read_contacts(device: String, memory: String) -> Result<String, String> {
    if memory != "ME" && memory != "SM" { return Err("Mémoire autorisée : ME (téléphone) ou SM (SIM).".into()); }
    run_gammu_read(&device, &["--getallmemory", &memory])
}
#[tauri::command]
pub fn classic_gammu_read_sms(device: String) -> Result<String, String> { run_gammu_read(&device, &["--getallsms"]) }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareValidation { pub file: String, pub requested_model: String, pub sha256: String, pub expected_sha256: String, pub valid: bool, pub status: String }
#[tauri::command]
pub fn classic_validate_firmware(file: String, connected_model: String, expected_model: String, expected_sha256: String) -> Result<FirmwareValidation, String> {
    if connected_model.trim().is_empty() || expected_model.trim().is_empty() { return Err("Le modèle détecté et le modèle attendu sont obligatoires.".into()); }
    if connected_model.trim() != expected_model.trim() { return Err(format!("Modèle incompatible : « {} » contre « {} ».", connected_model, expected_model)); }
    if expected_sha256.len() != 64 || !expected_sha256.chars().all(|c| c.is_ascii_hexdigit()) { return Err("Le SHA-256 attendu doit contenir 64 caractères hexadécimaux.".into()); }
    let path = Path::new(&file);
    if !path.is_file() { return Err("Le fichier firmware n'existe pas.".into()); }
    let output = Command::new("sha256sum").arg(path).output().map_err(|e| format!("sha256sum indisponible : {e}"))?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).to_string()); }
    let actual = String::from_utf8_lossy(&output.stdout).split_whitespace().next().unwrap_or("").to_lowercase();
    let expected = expected_sha256.to_lowercase();
    let valid = actual == expected;
    Ok(FirmwareValidation { file, requested_model: expected_model, sha256: actual, expected_sha256: expected, valid,
        status: if valid { "Modèle et empreinte concordants. Paquet contrôlé ; aucun flashage effectué.".into() } else { "Empreinte SHA-256 incorrecte : paquet refusé. Aucune écriture effectuée.".into() } })
}
