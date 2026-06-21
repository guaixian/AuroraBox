//! v2rayN-style proxy testing with real-time event emission.
//!
//! 3-layer model:
//!   1. TCP  — raw socket connect latency (ms)
//!   2. HTTP — real delay through proxy chain (ms)
//!   3. Speed — download throughput through proxy (KB/s), using curl for accuracy
//!
//! Emits `proxy-test-result` events after each server test so the frontend
//! can update the UI in real-time without waiting for all servers to finish.

use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

use crate::core::mixed_proxy_port;

#[derive(Serialize, Clone)]
pub struct ProxyTestResult {
    pub server: String,
    pub port: u16,
    pub tcp_ms: Option<u64>,
    pub real_ms: Option<u64>,
    pub speed_kbps: Option<f64>,
    pub error: Option<String>,
}

// ── TCP ping ───────────────────────────────────────────────────────

fn tcp_ping(host: &str, port: u16) -> Option<u64> {
    let start = Instant::now();
    let addr = format!("{}:{}", host, port).to_socket_addrs().ok()?.next()?;
    TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .ok()
        .map(|_| start.elapsed().as_millis() as u64)
}

// ── Main test command ──────────────────────────────────────────────

#[tauri::command]
pub async fn run_singbox_tests(
    app: AppHandle,
    outbounds: Vec<String>,
    speed_mb: Option<u64>,
) -> Result<Vec<ProxyTestResult>, String> {
    let mut results = Vec::new();
    let base_port = mixed_proxy_port(&app);
    let _mb = speed_mb.unwrap_or(10).max(10).min(500);

    for (i, outbound_json) in outbounds.into_iter().enumerate() {
        let test_port: u16 = base_port + 10 + (i as u16 % 40);

        let parsed: serde_json::Value =
            serde_json::from_str(&outbound_json).map_err(|e| format!("json: {}", e))?;
        let server = parsed["server"].as_str().unwrap_or("unknown").to_string();
        let svr_port = parsed["server_port"].as_u64().unwrap_or(0) as u16;
        let tag = parsed["tag"].as_str().unwrap_or("test-node").to_string();

        // ── Layer 1: TCP ping ──────────────────────────────────────
        let tcp_ms = tcp_ping(&server, svr_port);

        // ── Generate temp sing-box config ──────────────────────────
        // sing-box 1.12+ requires ENABLE_DEPRECATED_LEGACY_DNS_SERVERS
        // for the dns.servers format. Set it on the child process.
        let test_config = serde_json::json!({
            "log": { "disabled": true },
            "inbounds": [{
                "tag": "test-mixed",
                "type": "mixed",
                "listen": "127.0.0.1",
                "listen_port": test_port,
                "set_system_proxy": false
            }],
            "outbounds": [
                { "tag": "direct", "type": "direct" },
                parsed.clone()
            ],
            "route": {
                "rules": [
                    { "protocol": "dns", "outbound": "direct" }
                ],
                "final": tag,
                "auto_detect_interface": true
            }
        });

        let config_path = std::env::temp_dir()
            .join(format!("aurorabox-test-{}.json", test_port))
            .display()
            .to_string();
        std::fs::write(&config_path, test_config.to_string())
            .map_err(|e| format!("write cfg: {}", e))?;

        // ── Start temp sing-box ────────────────────────────────────
        let cmd = app
            .shell()
            .sidecar("sing-box")
            .map_err(|e| format!("sidecar: {}", e))?
            .args(["run", "-c", &config_path, "--disable-color"])
            .env("ENABLE_DEPRECATED_LEGACY_DNS_SERVERS", "true");

        let (_rx, child) = cmd.spawn().map_err(|e| format!("spawn: {}", e))?;
        let pid = child.pid();

        let mut ready = false;
        for _ in 0..60 {
            sleep(Duration::from_millis(250)).await;
            if TcpStream::connect(format!("127.0.0.1:{}", test_port)).is_ok() {
                ready = true;
                break;
            }
        }

        if !ready {
            let _result = ProxyTestResult {
                server: server.clone(), port: svr_port, tcp_ms,
                real_ms: None, speed_kbps: None,
                error: Some("sing-box start timeout".into()),
            };
            cleanup(pid, &config_path);
            let _ = app.emit("proxy-test-result", &_result);
            results.push(_result);
            continue;
        }

        sleep(Duration::from_millis(500)).await;

        // ── Layer 2: Real HTTP latency via curl ────────────────────
        let real_ms = {
            let proxy = format!("http://127.0.0.1:{}", test_port);
            let null = if cfg!(windows) { "nul" } else { "/dev/null" };
            let mut cmd = Command::new("curl");
            cmd.args([
                "-x", &proxy,
                "-s", "-o", null, "-w", "%{time_total}",
                "--connect-timeout", "5", "--max-time", "8",
                "http://www.gstatic.com/generate_204",
            ]);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let out = cmd.output();
            match out {
                Ok(o) if o.status.success() => {
                    let secs: f64 = String::from_utf8_lossy(&o.stdout).trim().parse().unwrap_or(0.0);
                    if secs > 0.0 { Some((secs * 1000.0) as u64) } else { None }
                }
                _ => None,
            }
        };
        let real_error = if real_ms.is_none() { Some("curl timeout".to_string()) } else { None };

        // ── Layer 3: Speed test: timed download (v2rayN-style) ─────
        // Downloads a large file for a fixed duration (e.g. 10s), then
        // measures average throughput. Does NOT download the whole file.
        let speed_kbps = {
            let proxy = format!("http://127.0.0.1:{}", test_port);
            let null = if cfg!(windows) { "nul" } else { "/dev/null" };
            let urls = [
                "http://cachefly.cachefly.net/10mb.test",
                "http://speedtest.tele2.net/10MB.zip",
                "http://ipv4.download.thinkbroadband.com/10MB.zip",
            ];
            let mut result = None;
            for url in &urls {
                let mut cmd = Command::new("curl");
                cmd.args([
                    "-x", &proxy,
                    "-s", "-o", null, "-w", "%{speed_download}",
                    "--connect-timeout", "5", "--max-time", "10",
                    url,
                ]);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                }
                let out = cmd.output();
                if let Ok(o) = out {
                    if o.status.success() {
                        let bps: f64 = String::from_utf8_lossy(&o.stdout).trim().parse().unwrap_or(0.0);
                        if bps > 0.0 {
                            result = Some(bps / 1024.0);
                            break;
                        }
                    }
                }
            }
            result
        };
        let speed_error = if speed_kbps.is_none() { Some("speed test failed".to_string()) } else { None };

        let error = if real_ms.is_none() && speed_kbps.is_none() {
            let combined = [
                real_error.as_deref().unwrap_or(""),
                speed_error.as_deref().unwrap_or(""),
            ]
            .join("; ");
            Some(if combined.is_empty() { "unreachable".into() } else { combined })
        } else {
            None
        };

        let result = ProxyTestResult {
            server: server.clone(),
            port: svr_port,
            tcp_ms,
            real_ms,
            speed_kbps,
            error,
        };

        // Emit real-time event so frontend updates immediately
        let _ = app.emit("proxy-test-result", &result);
        results.push(result);

        cleanup(pid, &config_path);
        sleep(Duration::from_millis(200)).await;
    }

    Ok(results)
}

fn cleanup(pid: u32, config_path: &str) {
    crate::utils::terminate_process(pid);
    std::thread::sleep(Duration::from_millis(300));
    crate::utils::force_kill(pid);
    let _ = std::fs::remove_file(config_path);
}
