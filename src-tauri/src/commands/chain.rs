//! True multi-instance proxy chain (A→B→C cascade).
//!
//! Architecture:
//!   Client → Instance-0 (entry) → Instance-1 (relay) → Instance-N (exit) → Internet
//!
//! Each instance is a standalone sing-box process with:
//!   mixed inbound  → outbound to next instance (or exit proxy)
//!
//! The entry instance's port is returned so the main engine can route through it.

use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

/// Active chain processes, keyed by chain group identifier.
/// Stores (pid, config_path, CommandChild) to keep processes alive.
static CHAIN_PROCESSES: Mutex<Option<Vec<(u32, String, tauri_plugin_shell::process::CommandChild)>>> = Mutex::new(None);

/// Start a multi-instance proxy chain.
///
/// `servers` is a list of sing-box outbound JSONs in chain order (0=entry, last=exit).
/// Returns the port of the entry instance.
#[tauri::command]
pub async fn start_chain(
    app: AppHandle,
    group_id: String,
    servers: Vec<String>,
) -> Result<u16, String> {
    // Kill any existing chain first, then force-clean ports
    stop_chain_inner();
    for port in 26780u16..26790 {
        let _ = std::process::Command::new("fuser").args(["-k", &format!("{}/tcp", port)]).output();
    }
    std::thread::sleep(Duration::from_millis(300));

    let base_port: u16 = 26780;
    let n = servers.len();
    if n < 2 {
        return Err("chain needs at least 2 servers".into());
    }

    let mut procs: Vec<(u32, String, tauri_plugin_shell::process::CommandChild)> = Vec::new();

    // Build from last (exit) to first (entry)
    for i in (0..n).rev() {
        let port = base_port + i as u16;
        let parsed: serde_json::Value =
            serde_json::from_str(&servers[i]).map_err(|e| format!("json: {}", e))?;

        let tag = format!("chain-hop-{}", i);
        let outbounds_array = if i == n - 1 {
            // Exit hop: use the FULL server outbound config (with tls/password/etc)
            let mut exit_ob = parsed.clone();
            exit_ob["tag"] = serde_json::Value::String(tag.clone());
            vec![
                serde_json::json!({ "tag": "direct", "type": "direct" }),
                exit_ob,
            ]
        } else {
            // Intermediate: HTTP proxy to next instance
            // HTTP chaining works correctly with mixed inbound→http outbound
            let next_port = base_port + (i + 1) as u16;
            vec![
                serde_json::json!({ "tag": "direct", "type": "direct" }),
                serde_json::json!({
                    "tag": &tag,
                    "type": "http",
                    "server": "127.0.0.1",
                    "server_port": next_port
                }),
            ]
        };

        let config = serde_json::json!({
            "log": { "level": "info" },
            "inbounds": [{
                "tag": &tag,
                "type": "mixed",
                "listen": "127.0.0.1",
                "listen_port": port
            }],
            "outbounds": outbounds_array,
            "route": {
                "rules": [{ "protocol": "dns", "outbound": "direct" }],
                "final": tag,
                "auto_detect_interface": true
            }
        });

        let config_path = format!("/tmp/aurorabox-chain-{}-{}.json", group_id, i);
        std::fs::write(&config_path, config.to_string())
            .map_err(|e| format!("write config {}: {}", config_path, e))?;

        let cmd = app
            .shell()
            .sidecar("sing-box")
            .map_err(|e| format!("sidecar: {}", e))?
            .args(["run", "-c", &config_path, "--disable-color"])
            .env("ENABLE_DEPRECATED_LEGACY_DNS_SERVERS", "true");

        let (_rx, child) = cmd.spawn().map_err(|e| format!("spawn hop {}: {}", i, e))?;
        let pid = child.pid();

        // Wait for this instance to be ready
        let mut ready = false;
        for _ in 0..40 {
            sleep(Duration::from_millis(200)).await;
            if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                ready = true;
                break;
            }
        }

        if !ready {
            // Kill all started instances
            for (pid, path, _child) in &procs {
                unsafe { libc::kill(*pid as i32, libc::SIGKILL); }
                let _ = std::fs::remove_file(path);
            }
            unsafe { libc::kill(pid as i32, libc::SIGKILL); }
            let _ = std::fs::remove_file(&config_path);
            return Err(format!("hop {} failed to start", i));
        }

        procs.push((pid, config_path, child));
        log::info!("[chain] hop {} started on port {} (pid={})", i, port, pid);
    }

    let entry_port = base_port;
    *CHAIN_PROCESSES.lock().unwrap_or_else(|e| e.into_inner()) = Some(procs);

    log::info!("[chain] cascade ready, entry port={}", entry_port);
    Ok(entry_port)
}

/// Stop all chain instances.
#[tauri::command]
pub async fn stop_chain() -> Result<(), String> {
    stop_chain_inner();
    Ok(())
}

fn stop_chain_inner() {
    let mut guard = match CHAIN_PROCESSES.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    if let Some(procs) = guard.take() {
        for (pid, path, _child) in &procs {
            unsafe { libc::kill(*pid as i32, libc::SIGTERM); }
            std::thread::sleep(Duration::from_millis(200));
            unsafe { libc::kill(*pid as i32, libc::SIGKILL); }
            let _ = std::fs::remove_file(path);
            log::info!("[chain] stopped hop pid={}", pid);
        }
        // procs dropped here, _child handles released
    }
}
