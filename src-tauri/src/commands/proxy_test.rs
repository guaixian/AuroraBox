//! v2rayN-style proxy testing with real-time event emission.
//!
//! 3-layer model:
//!   1. TCP  — raw socket connect latency (ms)
//!   2. HTTP — real delay through proxy chain (ms), using gstatic.com/generate_204
//!   3. Speed — download throughput through proxy (KB/s), using tele2.net test file
//!
//! Emits `proxy-test-result` events after each server test so the frontend
//! can update the UI in real-time without waiting for all servers to finish.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
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

// ── Test URLs ──────────────────────────────────────────────────────

/// Latency probe: tiny HTTP 204 response
const LATENCY_URL: &str = "http://www.gstatic.com/generate_204";
/// Speed test: reliable HTTP download (10 MB)
const SPEED_URL: &str = "http://speedtest.tele2.net/10MB.zip";
/// How long to wait for speed download
const SPEED_TIMEOUT_SECS: u64 = 45;

// ── Rust HTTP client through HTTP proxy ────────────────────────────

struct ProxyHttpResponse {
    status: u16,
    body_len: usize,
    elapsed_ms: u64,
}

/// Send HTTP GET through an HTTP proxy (e.g., sing-box mixed inbound)
/// and return status + body length + elapsed time.
fn http_get_via_proxy(
    proxy_port: u16,
    url: &str,
    timeout: Duration,
) -> Result<ProxyHttpResponse, String> {
    let start = Instant::now();

    // Parse URL
    let (host, port, path) = parse_http_url(url)?;

    let addr = format!("127.0.0.1:{}", proxy_port)
        .to_socket_addrs()
        .map_err(|e| format!("resolve proxy: {}", e))?
        .next()
        .ok_or("no proxy addr")?;

    let mut sock = TcpStream::connect_timeout(&addr, timeout)
        .map_err(|e| format!("connect proxy: {}", e))?;
    sock.set_read_timeout(Some(timeout))
        .map_err(|e| format!("timeout: {}", e))?;

    // HTTP proxy: absolute URL in request line
    let host_header = if port == 80 {
        host.clone()
    } else {
        format!("{}:{}", host, port)
    };
    let abs_url = if port == 80 {
        format!("http://{}{}", host, path)
    } else {
        format!("http://{}:{}{}", host, port, path)
    };
    let req = format!(
        "GET {} HTTP/1.0\r\nHost: {}\r\nUser-Agent: AuroraBox/1.0\r\nConnection: close\r\n\r\n",
        abs_url, host_header
    );

    sock.write_all(req.as_bytes())
        .map_err(|e| format!("write: {}", e))?;

    // Read response
    let mut buf = vec![0u8; 32768];
    let mut all = Vec::new();
    loop {
        match sock.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                all.extend_from_slice(&buf[..n]);
                if all.len() > 50 * 1024 * 1024 {
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(ref e) if e.kind() == std::io::ErrorKind::TimedOut => break,
            Err(_) => break,
        }
    }

    let elapsed_ms = start.elapsed().as_millis() as u64;

    // Parse status code
    let status = if let Some(body_start) = find_header_end(&all) {
        let hdr = String::from_utf8_lossy(&all[..body_start]);
        hdr.lines()
            .next()
            .and_then(|l| {
                let parts: Vec<&str> = l.split_whitespace().collect();
                if parts.len() >= 2 {
                    parts[1].parse().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0)
    } else {
        0
    };
    let body_len = all.len().saturating_sub(
        find_header_end(&all).unwrap_or(0)
    );

    // Accept 2xx and 3xx (redirect) — many test URLs redirect
    if status < 200 || status >= 400 {
        return Err(format!("HTTP {}", status));
    }

    Ok(ProxyHttpResponse { status, body_len, elapsed_ms })
}

fn parse_http_url(url: &str) -> Result<(String, u16, String), String> {
    let s = url
        .strip_prefix("http://")
        .ok_or("only http:// supported")?;
    let slash = s.find('/').unwrap_or(s.len());
    let host_part = &s[..slash];
    let path = if slash < s.len() { &s[slash..] } else { "/" };
    let (host, port) = if let Some(c) = host_part.find(':') {
        (host_part[..c].to_string(), host_part[c + 1..].parse::<u16>().unwrap_or(80))
    } else {
        (host_part.to_string(), 80u16)
    };
    Ok((host, port, path.to_string()))
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    for i in 0..data.len().saturating_sub(3) {
        if &data[i..i + 4] == b"\r\n\r\n" {
            return Some(i + 4);
        }
    }
    None
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

        let config_path = format!("/tmp/aurorabox-test-{}.json", test_port);
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

        // ── Layer 2: Real HTTP latency ─────────────────────────────
        let (real_ms, real_error) = match http_get_via_proxy(
            test_port, LATENCY_URL, Duration::from_secs(10),
        ) {
            Ok(resp) => (Some(resp.elapsed_ms), None),
            Err(e) => (None, Some(e)),
        };

        // ── Layer 3: Speed test ────────────────────────────────────
        let (speed_kbps, speed_error) = match http_get_via_proxy(
            test_port, SPEED_URL, Duration::from_secs(SPEED_TIMEOUT_SECS),
        ) {
            Ok(resp) if resp.body_len > 0 => {
                let secs = (resp.elapsed_ms as f64) / 1000.0;
                let kbps = (resp.body_len as f64) / 1024.0 / secs.max(0.5);
                (Some(kbps), None)
            }
            Ok(_) => (None, Some("empty response".to_string())),
            Err(e) => (None, Some(e)),
        };

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
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(300));
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
    let _ = std::fs::remove_file(config_path);
}
