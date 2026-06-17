//! Proxy server testing via dedicated sing-box instances.
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
    pub server: String,
    pub port: u16,
    pub latency_ms: Option<u64>,
    /// KB/s download speed.
    pub speed_kbps: Option<f64>,
    pub error: Option<String>,
}

/// Run latency AND/OR speed tests against a list of sing-box outbound
/// JSON definitions. Each outbound gets a dedicated sing-box instance.
///
/// - `test_latency`: measure HTTP round-trip time through the proxy
/// - `test_speed`: download a file and measure throughput (KB/s)
/// - `speed_mb`: size of the download file in MB (default 100)
#[tauri::command]
pub async fn run_singbox_tests(
    app: AppHandle,
    outbounds: Vec<String>,
    speed_mb: Option<u64>,
) -> Result<Vec<ProxyTestResult>, String> {
    let mut results = Vec::new();
    let base_port = mixed_proxy_port(&app);
    let mb = speed_mb.unwrap_or(100).max(10).min(1024);

    for (i, outbound_json) in outbounds.into_iter().enumerate() {
        let test_port: u16 = base_port + 1 + (i as u16 % 50);

        let parsed: serde_json::Value = serde_json::from_str(&outbound_json)
            .map_err(|e| format!("invalid outbound JSON: {}", e))?;
        let server = parsed.get("server").and_then(|s| s.as_str()).unwrap_or("unknown");
        let svr_port: u16 = parsed.get("server_port").and_then(|p| p.as_u64()).unwrap_or(0) as u16;

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
                parsed.clone(),
            ],
            "route": {
                "rules": [],
                "final": parsed.get("tag").cloned().unwrap_or(serde_json::Value::String("direct".into())),
                "auto_detect_interface": true
            }
        });

        let config_path = format!("/tmp/aurorabox-test-{}.json", test_port);
        std::fs::write(&config_path, test_config.to_string())
            .map_err(|e| format!("write config: {}", e))?;

        // ── Start sing-box ─────────────────────────────────────────
        let cmd = app
            .shell()
            .sidecar("sing-box")
            .map_err(|e| format!("sidecar: {}", e))?
            .args(["run", "-c", &config_path, "--disable-color"]);

        let (_rx, child) = cmd.spawn().map_err(|e| format!("spawn: {}", e))?;
        let pid = child.pid();

        // Wait for port ready
        let mut ready = false;
        for _ in 0..40 {
            sleep(Duration::from_millis(250)).await;
            if std::net::TcpStream::connect(format!("127.0.0.1:{}", test_port)).is_ok() {
                ready = true;
                break;
            }
        }

        if !ready {
            cleanup(pid, &config_path);
            results.push(ProxyTestResult { server: server.into(), port: svr_port, latency_ms: None, speed_kbps: None, error: Some("sing-box start timeout".into()) });
            continue;
        }

        let proxy_addr = format!("http://127.0.0.1:{}", test_port);

        // ── Latency test ────────────────────────────────────────────
        let latency_ms = {
            let start = std::time::Instant::now();
            let out = Command::new("curl")
                .args(["-x", &proxy_addr, "-s", "-o", "/dev/null", "-w", "%{time_total}",
                       "--connect-timeout", "5", "--max-time", "8",
                       "http://www.gstatic.com/generate_204"])
                .output();
            match out {
                Ok(o) if o.status.success() => {
                    let secs: f64 = String::from_utf8_lossy(&o.stdout).trim().parse().unwrap_or(0.0);
                    if secs > 0.0 { Some((secs * 1000.0) as u64) } else { None }
                }
                _ => None,
            }
        };

        // ── Speed test: download large file ────────────────────────
        let speed_kbps = {
            let url = format!("https://speed.cloudflare.com/__down?bytes={}", mb * 1024 * 1024);
            let start = std::time::Instant::now();
            let out = Command::new("curl")
                .args(["-x", &proxy_addr, "-s", "-o", "/dev/null", "-w", "%{size_download}",
                       "--connect-timeout", "5", "--max-time", "60",
                       &url])
                .output();
            let elapsed = start.elapsed().as_secs_f64().max(0.5);
            match out {
                Ok(o) if o.status.success() => {
                    let bytes: f64 = String::from_utf8_lossy(&o.stdout).trim().parse().unwrap_or(0.0);
                    if bytes > 0.0 { Some(bytes / 1024.0 / elapsed) } else { None }
                }
                _ => None,
            }
        };

        cleanup(pid, &config_path);

        results.push(ProxyTestResult {
            server: server.into(), port: svr_port,
            latency_ms, speed_kbps,
            error: if latency_ms.is_none() && speed_kbps.is_none() { Some("unreachable".into()) } else { None },
        });

        sleep(Duration::from_millis(300)).await;
    }

    Ok(results)
}

fn cleanup(pid: u32, config_path: &str) {
    unsafe { libc::kill(pid as i32, libc::SIGKILL); }
    let _ = std::fs::remove_file(config_path);
}
