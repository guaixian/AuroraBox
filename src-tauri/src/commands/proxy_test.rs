//! Proxy server performance testing via dedicated sing-box instances.
//!
//! Each test spins up a temporary sing-box process on a unique port,
//! routes a probe through it, measures latency / throughput, then
//! tears the process down.

use std::process::Command;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

use crate::core::mixed_proxy_port;

/// Performance test result for one proxy server.
#[derive(Serialize, Clone)]
pub struct ProxyTestResult {
    /// Key to match back to the frontend server list.
    pub server: String,
    pub port: u16,
    /// HTTP latency through the proxy in milliseconds.
    pub latency_ms: Option<u64>,
    /// Download throughput in KB/s.
    pub speed_kbps: Option<f64>,
    /// Human-readable error.
    pub error: Option<String>,
}

/// Run latency + speed tests for a list of sing-box outbound JSON definitions.
/// Each outbound gets a dedicated sing-box instance on a temporary port.
#[tauri::command]
pub async fn run_singbox_tests(
    app: AppHandle,
    outbounds: Vec<String>,
) -> Result<Vec<ProxyTestResult>, String> {
    let mut results = Vec::new();
    let base_port = mixed_proxy_port(&app);

    for (i, outbound_json) in outbounds.into_iter().enumerate() {
        let test_port: u16 = base_port + 1 + (i as u16 % 50);

        // Parse the outbound to get server tag
        let _server_tag: String = serde_json::from_str::<serde_json::Value>(&outbound_json)
            .ok()
            .and_then(|v| v.get("tag").and_then(|t| t.as_str().map(String::from)))
            .unwrap_or_else(|| format!("test-{}", i));

        let server = serde_json::from_str::<serde_json::Value>(&outbound_json)
            .ok()
            .and_then(|v| v.get("server").and_then(|s| s.as_str().map(String::from)))
            .unwrap_or_default();

        let svr_port: u16 = serde_json::from_str::<serde_json::Value>(&outbound_json)
            .ok()
            .and_then(|v| v.get("server_port").and_then(|p| p.as_u64()))
            .unwrap_or(0) as u16;

        // ── Generate minimal test config ────────────────────────────
        let test_config = serde_json::json!({
            "log": { "disabled": true },
            "inbounds": [{
                "tag": "test-mixed",
                "type": "mixed",
                "listen": "127.0.0.1",
                "listen_port": test_port
            }],
            "outbounds": [
                { "tag": "direct", "type": "direct" },
                serde_json::from_str::<serde_json::Value>(&outbound_json).unwrap_or_default(),
            ],
            "route": {
                "rules": [],
                "final": serde_json::from_str::<serde_json::Value>(&outbound_json)
                    .ok()
                    .and_then(|v| v.get("tag").cloned())
                    .unwrap_or(serde_json::Value::String("direct".into())),
                "auto_detect_interface": true
            }
        });

        let config_str = test_config.to_string();
        let config_path = format!("/tmp/aurorabox-test-{}.json", test_port);
        std::fs::write(&config_path, &config_str)
            .map_err(|e| format!("write config: {}", e))?;

        // ── Start sing-box ─────────────────────────────────────────
        let cmd = app
            .shell()
            .sidecar("sing-box")
            .map_err(|e| format!("sidecar: {}", e))?
            .args(["run", "-c", &config_path, "--disable-color"]);

        let (rx, child) = cmd.spawn().map_err(|e| format!("spawn: {}", e))?;

        // Wait for sing-box to be ready (port listening)
        let mut ready = false;
        for _ in 0..30 {
            sleep(Duration::from_millis(200)).await;
            if std::net::TcpStream::connect(format!("127.0.0.1:{}", test_port)).is_ok() {
                ready = true;
                break;
            }
        }

        if !ready {
            let _ = child.kill();
            let _ = std::fs::remove_file(&config_path);
            results.push(ProxyTestResult {
                server: server.clone(),
                port: svr_port,
                latency_ms: None,
                speed_kbps: None,
                error: Some("sing-box failed to start".into()),
            });
            continue;
        }

        // ── Latency test via curl ──────────────────────────────────
        let latency_ms = {
            let start = std::time::Instant::now();
            let out = Command::new("curl")
                .args([
                    "-x", &format!("http://127.0.0.1:{}", test_port),
                    "-s", "-o", "/dev/null", "-w", "%{time_total}",
                    "--connect-timeout", "8", "--max-time", "10",
                    "http://www.gstatic.com/generate_204",
                ])
                .output();
            let elapsed = start.elapsed();
            match out {
                Ok(o) if o.status.success() => {
                    let secs: f64 = String::from_utf8_lossy(&o.stdout)
                        .parse()
                        .unwrap_or(elapsed.as_secs_f64());
                    Some((secs * 1000.0) as u64)
                }
                _ => None,
            }
        };

        // ── Speed test via curl ────────────────────────────────────
        let speed_kbps = {
            let start = std::time::Instant::now();
            let out = Command::new("curl")
                .args([
                    "-x", &format!("http://127.0.0.1:{}", test_port),
                    "-s", "-o", "/dev/null", "-w", "%{size_download}",
                    "--connect-timeout", "8", "--max-time", "15",
                    "https://speed.cloudflare.com/__down?bytes=1048576",
                ])
                .output();
            let elapsed = start.elapsed().as_secs_f64().max(0.1);
            match out {
                Ok(o) if o.status.success() => {
                    let bytes: f64 = String::from_utf8_lossy(&o.stdout)
                        .parse()
                        .unwrap_or(0.0);
                    Some(bytes / 1024.0 / elapsed)
                }
                _ => None,
            }
        };

        // ── Cleanup ────────────────────────────────────────────────
        let _ = child.kill();
        // Drain the process output
        let _ = rx;
        let _ = std::fs::remove_file(&config_path);

        results.push(ProxyTestResult {
            server: server.clone(),
            port: svr_port,
            latency_ms,
            speed_kbps,
            error: if latency_ms.is_none() && speed_kbps.is_none() {
                Some("unreachable".into())
            } else {
                None
            },
        });

        sleep(Duration::from_millis(300)).await;
    }

    Ok(results)
}
