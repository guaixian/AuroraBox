//! Read traffic stats from sing-box Clash API.
use std::process::Command;

#[derive(serde::Serialize)]
pub struct TrafficStats {
    pub up: u64,
    pub down: u64,
}

/// Fetch current traffic stats from the Clash API at 127.0.0.1:9191.
/// Returns latest values from the NDJSON SSE stream.
#[tauri::command]
pub fn get_traffic() -> Result<TrafficStats, String> {
    let output = Command::new("curl")
        .args(["-s", "--max-time", "2", "http://127.0.0.1:9191/traffic"])
        .output()
        .map_err(|e| format!("curl failed: {}", e))?;

    let text = String::from_utf8_lossy(&output.stdout);
    // Traffic API returns newline-delimited JSON — take last line
    if let Some(last) = text.trim().lines().last() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(last) {
            return Ok(TrafficStats {
                up: v["up"].as_u64().unwrap_or(0),
                down: v["down"].as_u64().unwrap_or(0),
            });
        }
    }
    Ok(TrafficStats { up: 0, down: 0 })
}
