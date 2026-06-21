//! Read traffic stats from sing-box Clash API.
//!
//! We use async TCP with a time-bounded read because the /traffic
//! endpoint is an SSE stream that never closes — `read_to_end` would
//! block forever.

use std::time::Duration;
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::app::state::AppData;

#[derive(serde::Serialize)]
pub struct TrafficStats {
    pub up: u64,
    pub down: u64,
}

/// Fetch current traffic stats from sing-box's Clash API at
/// 127.0.0.1:9191. The endpoint streams NDJSON indefinitely, so we
/// read for at most 1.5 seconds then take the last complete line.
#[tauri::command]
pub async fn get_traffic(app: tauri::AppHandle) -> Result<TrafficStats, String> {
    let secret = app
        .state::<AppData>()
        .get_clash_secret()
        .unwrap_or_default();

    let mut stream = timeout(
        Duration::from_secs(2),
        TcpStream::connect("127.0.0.1:9191"),
    )
    .await
    .map_err(|_| "connect timeout".to_string())?
    .map_err(|e| format!("connect 127.0.0.1:9191: {e}"))?;

    let req = if secret.is_empty() {
        "GET /traffic HTTP/1.0\r\nHost: 127.0.0.1:9191\r\nConnection: close\r\n\r\n".to_string()
    } else {
        format!(
            "GET /traffic HTTP/1.0\r\nHost: 127.0.0.1:9191\r\nAuthorization: Bearer {secret}\r\nConnection: close\r\n\r\n"
        )
    };
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| format!("write: {e}"))?;

    // Read whatever arrives within 1.5 s — enough to capture several
    // NDJSON lines without blocking the caller indefinitely.
    let mut buf = vec![0u8; 8192];
    let mut total = Vec::new();
    let deadline = Duration::from_millis(1500);
    let read = async {
        loop {
            match stream.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => total.extend_from_slice(&buf[..n]),
                Err(_) => break,
            }
        }
    };
    let _ = timeout(deadline, read).await;
    // stream is dropped here → connection closed

    let text = String::from_utf8_lossy(&total);
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

    // Take the last NDJSON line (most recent cumulative stats).
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
