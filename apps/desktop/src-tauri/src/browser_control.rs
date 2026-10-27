use serde_json::{json, Value};
use std::{fs, io::{Read, Write}, net::{TcpStream, ToSocketAddrs}, path::Path, process::{Command, Stdio}, time::Duration};
use tungstenite::{connect, Message};

fn command_exists(program: &str) -> bool {
    let finder = if cfg!(target_os = "windows") { "where.exe" } else { "which" };
    Command::new(finder).arg(program).output().map(|o| o.status.success()).unwrap_or(false)
}

fn http_json(path: &str) -> Result<Value, String> {
    if !path.starts_with("/json/") || path.contains("..") { return Err("Chemin CDP invalide.".into()); }
    let mut stream = TcpStream::connect(("127.0.0.1", 9222)
        ).map_err(|e| format!("Navigateur contrôlé absent sur le port 9222 : {e}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nConnection: close\r\n\r\n")
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let response = String::from_utf8_lossy(&bytes);
    let body = response.split_once("\r\n\r\n").map(|(_, body)| body).ok_or("Réponse HTTP invalide.")?;
    serde_json::from_str(body).map_err(|e| format!("Réponse du navigateur invalide : {e}"))
}

fn page_ws() -> Result<String, String> {
    let list = http_json("/json/list")?;
    list.as_array().and_then(|items| items.iter()
        .find(|item| item.get("type").and_then(Value::as_str) == Some("page"))
        .and_then(|item| item.get("webSocketDebuggerUrl").and_then(Value::as_str))
        .map(str::to_string))
        .ok_or_else(|| "Aucun onglet contrôlable. Démarre d'abord le navigateur contrôlé.".into())
}

fn cdp(method: &str, params: Value) -> Result<Value, String> {
    let ws = page_ws()?;
    let (mut socket, _) = connect(ws.as_str()).map_err(|e| format!("Connexion CDP impossible : {e}"))?;
    socket.send(Message::Text(json!({"id":1,"method":method,"params":params}).to_string().into()))
        .map_err(|e| e.to_string())?;
    loop {
        let message = socket.read().map_err(|e| format!("Réponse CDP impossible : {e}"))?;
        if let Message::Text(text) = message {
            let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            if value.get("id").and_then(Value::as_u64) == Some(1) {
                if let Some(error) = value.get("error") { return Err(format!("Erreur navigateur : {error}")); }
                return Ok(value.get("result").cloned().unwrap_or(Value::Null));
            }
        }
    }
}

fn safe_url(raw: &str) -> Result<String, String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "URL invalide.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("Seules les URL HTTP/HTTPS sont autorisées.".into()); }
    let host = parsed.host_str().ok_or("Nom d'hôte manquant.")?.to_lowercase();
    if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") {
        return Err("Les adresses locales sont bloquées.".into());
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        let blocked = match ip {
            std::net::IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_broadcast(),
            std::net::IpAddr::V6(v) => v.is_loopback() || v.is_unspecified() || v.is_unique_local() || v.is_unicast_link_local(),
        };
        if blocked { return Err("Les adresses IP privées/locales sont bloquées.".into()); }
    } else {
        // Refuse hostnames that resolve to local/private addresses (basic DNS-rebinding mitigation).
        let port = parsed.port_or_known_default().ok_or("Port URL invalide.")?;
        let resolved = (host.as_str(), port).to_socket_addrs()
            .map_err(|_| "Impossible de vérifier l'adresse du site via DNS.".to_string())?
            .collect::<Vec<_>>();
        if resolved.is_empty() { return Err("Le nom de domaine ne résout vers aucune adresse.".into()); }
        for address in resolved {
            let ip = address.ip();
            let blocked = match ip {
                std::net::IpAddr::V4(v) => v.is_private() || v.is_loopback() || v.is_link_local() || v.is_unspecified() || v.is_broadcast(),
                std::net::IpAddr::V6(v) => v.is_loopback() || v.is_unspecified() || v.is_unique_local() || v.is_unicast_link_local(),
            };
            if blocked { return Err("Le domaine pointe vers une adresse IP privée/locale ; navigation bloquée.".into()); }
        }
    }
    Ok(parsed.to_string())
}

pub fn start() -> Result<String, String> {
    let profile = std::env::temp_dir().join("nexus-control-browser-profile");
    fs::create_dir_all(&profile).map_err(|e| e.to_string())?;
    if http_json("/json/version").is_ok() {
        return Ok("Le navigateur contrôlé est déjà actif dans son profil dédié.".into());
    }
    #[cfg(target_os = "linux")]
    let candidates = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
    #[cfg(target_os = "macos")]
    let candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "chromium", "google-chrome"];
    #[cfg(target_os = "windows")]
    let candidates = ["chrome.exe", "msedge.exe", "chromium.exe", "chrome"];
    let executable = candidates.iter().find(|name| if name.contains('/') { Path::new(name).is_file() } else { command_exists(name) })
        .ok_or("Installe Google Chrome ou Chromium avant de démarrer le navigateur contrôlé.")?;
    Command::new(executable)
        .args(["--remote-debugging-port=9222", "--remote-debugging-address=127.0.0.1",
            "--remote-allow-origins=*", "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank"])
        .arg(format!("--user-data-dir={}", profile.display()))
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("Démarrage du navigateur impossible : {e}"))?;
    std::thread::sleep(Duration::from_millis(900));
    http_json("/json/version").map_err(|_| "Navigateur lancé mais port de contrôle pas encore prêt. Réessaie.".to_string())?;
    Ok("Navigateur contrôlé démarré dans un profil séparé. Les onglets personnels ne sont pas exposés.".into())
}

pub fn navigate(raw: &str) -> Result<String, String> {
    let url = safe_url(raw)?;
    cdp("Page.enable", json!({}))?;
    cdp("Page.navigate", json!({"url":url}))?;
    Ok(format!("Navigation demandée : {url}"))
}

pub fn snapshot() -> Result<String, String> {
    let result = cdp("Runtime.evaluate", json!({"returnByValue":true,"expression":
        "JSON.stringify({title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,12000),elements:[...document.querySelectorAll('a,button,input,textarea,select,[role=button]')].slice(0,100).map((e,i)=>({index:i,tag:e.tagName,text:(e.innerText||e.getAttribute('aria-label')||e.placeholder||'').trim().slice(0,140),type:e.type||'',name:e.name||'',id:e.id||'',href:e.href||''}))})"}))?;
    let value = result.pointer("/result/result/value").and_then(Value::as_str).ok_or("Lecture de page impossible.")?;
    let parsed: Value = serde_json::from_str(value).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())
}

pub fn click(selector: &str) -> Result<String, String> {
    if selector.trim().is_empty() || selector.len() > 500 { return Err("Sélecteur CSS invalide (1 à 500 caractères).".into()); }
    let selector = serde_json::to_string(selector).map_err(|e| e.to_string())?;
    let expression = format!("(()=>{{const s={selector};const e=document.querySelector(s);if(!e)return 'Élément introuvable : '+s;const t=((e.innerText||e.value||e.getAttribute('aria-label')||'')+'').trim().toLowerCase();if(e.matches('button[type=submit],input[type=submit],button[form],input[type=image]')||/(payer|payment|purchase|acheter|commander|supprimer|delete|remove|confirmer|confirm|envoyer|submit|sign out|déconnexion)/i.test(t))return 'Action bloquée : validation ou action potentiellement sensible. Vérifie puis effectue cette étape manuellement.';e.scrollIntoView({block:'center'});e.click();return 'Élément cliqué : '+s}})()");
    let result = cdp("Runtime.evaluate", json!({"expression":expression,"returnByValue":true}))?;
    result.pointer("/result/result/value").and_then(Value::as_str).map(str::to_string).ok_or("Résultat du clic indisponible.".into())
}

pub fn fill(selector: &str, value: &str) -> Result<String, String> {
    if selector.trim().is_empty() || selector.len() > 500 || value.len() > 20000 {
        return Err("Sélecteur invalide ou texte supérieur à 20 000 caractères.".into());
    }
    let selector = serde_json::to_string(selector).map_err(|e| e.to_string())?;
    let value = serde_json::to_string(value).map_err(|e| e.to_string())?;
    let expression = format!("(()=>{{const s={selector};const e=document.querySelector(s);if(!e)return 'Champ introuvable : '+s;if(e.disabled||e.readOnly)return 'Champ désactivé ou en lecture seule.';if(e instanceof HTMLInputElement&&(/password|one-time-code|cc-number|cc-csc/i.test(e.type+' '+e.autocomplete)||e.type==='password'))return 'Champ de mot de passe, code ou carte bancaire bloqué par sécurité.';if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement||e instanceof HTMLSelectElement||e.isContentEditable))return 'Type de champ non pris en charge.';const v={value};if(e.isContentEditable)e.textContent=v;else{{const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;if(setter)setter.call(e,v);else e.value=v}}e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));return 'Champ rempli : '+s+' (valeur masquée dans le journal).'}})()");
    let result = cdp("Runtime.evaluate", json!({"expression":expression,"returnByValue":true}))?;
    result.pointer("/result/result/value").and_then(Value::as_str).map(str::to_string).ok_or("Résultat de saisie indisponible.".into())
}
