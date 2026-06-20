//! Read traffic stats from sing-box Clash API via raw TCP.
//!
//! We use a raw TcpStream + manual HTTP GET instead of `curl` because
//! the SystemProxy start path sets HTTP_PROXY env vars on the Rust
//! process, which `curl` (spawned as a child) inherits — causing the
//! request to 127.0.0.1:9191 to loop back through the sing-box mixed
//! inbound instead of connecting directly to the Clash API listener.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use tauri::Manager;

use crate::app::state::AppData;

#[derive(serde::Serialize)]
pub struct TrafficStats {
    pub up: u64,
    pub down: u64,
}

/// Fetch current traffic stats from sing-box's Clash API at
/// 127.0.0.1:9191. Reads the API secret from AppData (set by the
/// `is_running` command on engine start) and includes it in the
/// Authorization header.
#[tauri::command]
pub fn get_traffic(app: tauri::AppHandle) -> Result<TrafficStats, String> {
    let secret = app
        .state::<AppData>()
        .get_clash_secret()
        .unwrap_or_default();

    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:9191".parse().map_err(|e| format!("bad addr: {e}"))?,
        Duration::from_secs(2),
    )
    .map_err(|e| format!("connect 127.0.0.1:9191: {e}"))?;

    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|e| format!("set timeout: {e}"))?;

    let req = if secret.is_empty() {
        "GET /traffic HTTP/1.0\r\nHost: 127.0.0.1:9191\r\nConnection: close\r\n\r\n".to_string()
    } else {
        format!(
            "GET /traffic HTTP/1.0\r\nHost: 127.0.0.1:9191\r\nAuthorization: Bearer {secret}\r\nConnection: close\r\n\r\n"
        )
    };
    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("write: {e}"))?;

    let mut buf = Vec::new();
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("read: {e}"))?;

    let text = String::from_utf8_lossy(&buf);
    // HTTP/1.0 response: headers then \r\n\r\n then body (NDJSON lines)
    let body = text
        .split("\r\n\r\n")
        .nth(1)
        .unwrap_or(&text)
        .trim()
        .to_string();

    if body.is_empty() {
        log::debug!("[traffic] empty response body");
        return Ok(TrafficStats { up: 0, down: 0 });
    }

    // Traffic API returns newline-delimited JSON — take the last line
    // (most recent cumulative stats).
    if let Some(last) = body.lines().last() {
        match serde_json::from_str::<serde_json::Value>(last) {
            Ok(v) => {
                let up = v["up"].as_u64().unwrap_or(0);
                let down = v["down"].as_u64().unwrap_or(0);
                log::debug!("[traffic] up={up} down={down}");
                return Ok(TrafficStats { up, down });
            }
            Err(e) => log::debug!("[traffic] json parse: {e} raw={last:.120}"),
        }
    }
    Ok(TrafficStats { up: 0, down: 0 })
}
