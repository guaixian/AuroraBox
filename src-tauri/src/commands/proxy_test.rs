//! v2rayN-style proxy testing: TCP connect → real HTTP through proxy → speed test.
//!
//! Three-layer model:
//!   1. TCP layer  — raw socket connect to server:port (tcping)
//!   2. HTTP layer — GET http://cp.cloudflare.com/ through the proxy chain
//!   3. Speed layer — download real data through proxy, measure KB/s
//!
//! Each server gets a temporary sing-box instance on a dedicated port so
//! tests are isolated and don't interfere with the main engine.

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;
use tokio::time::sleep;

use crate::core::mixed_proxy_port;

#[derive(Serialize, Clone)]
pub struct ProxyTestResult {
    pub server: String,
    pub port: u16,
    /// TCP handshake latency (milliseconds)
    pub tcp_ms: Option<u64>,
    /// Real HTTP latency through the proxy chain (milliseconds)
    pub real_ms: Option<u64>,
    /// Download speed in KB/s
    pub speed_kbps: Option<f64>,
    pub error: Option<String>,
}

// ── Rust-native HTTP through proxy (zero external deps) ────────────

/// Send an HTTP GET request through an HTTP proxy, read the response
/// body, and return (elapsed_ms, bytes_read, status_code).
fn http_get_via_proxy(
    proxy_host: &str,
    proxy_port: u16,
    url: &str,
    timeout: Duration,
) -> Result<(u64, usize, u16), String> {
    let start = Instant::now();
    let mut sock = TcpStream::connect_timeout(
        &format!("{}:{}", proxy_host, proxy_port)
            .to_socket_addrs()
            .map_err(|e| format!("resolve: {}", e))?
            .next()
            .ok_or("no addr")?,
        timeout,
    )
    .map_err(|e| format!("connect: {}", e))?;
    sock.set_read_timeout(Some(timeout))
        .map_err(|e| format!("set timeout: {}", e))?;

    // Parse URL to extract host and path
    let (host, path) = {
        let s = url
            .strip_prefix("http://")
            .or_else(|| url.strip_prefix("https://"))
            .unwrap_or(url);
        let slash = s.find('/').unwrap_or(s.len());
        let host_part = &s[..slash];
        let first_colon = host_part.find(':');
        let clean_host = if let Some(c) = first_colon {
            &host_part[..c]
        } else {
            host_part
        };
        let path_part = if slash < s.len() { &s[slash..] } else { "/" };
        (clean_host.to_string(), path_part.to_string())
    };

    // Simple HTTP proxy request (absolute URL for http:// targets)
    let absolute_url = format!("http://{}{}", host, path);
    let req = format!(
        "GET {} HTTP/1.0\r\nHost: {}\r\nUser-Agent: AuroraBox/1.0\r\nConnection: close\r\n\r\n",
        absolute_url, host
    );

    sock.write_all(req.as_bytes())
        .map_err(|e| format!("write: {}", e))?;

    let mut buf = vec![0u8; 65536];
    let mut total = 0usize;
    let mut status = 0u16;
    let mut headers_done = false;
    let mut header_buf = Vec::new();

    loop {
        let n = sock.read(&mut buf).map_err(|e| format!("read: {}", e))?;
        if n == 0 {
            break;
        }
        if !headers_done {
            header_buf.extend_from_slice(&buf[..n]);
            if let Some(body_start) = find_header_end(&header_buf) {
                // Parse status code
                let hdr = String::from_utf8_lossy(&header_buf[..body_start]);
                if let Some(code) = hdr.lines().next().and_then(|l| {
                    let parts: Vec<&str> = l.split_whitespace().collect();
                    if parts.len() >= 2 { parts[1].parse().ok() } else { None }
                }) {
                    status = code;
                }
                total = header_buf.len() - body_start;
                headers_done = true;
            }
        } else {
            total += n;
        }
        if total > 100 * 1024 * 1024 {
            break;
        } // cap at 100MB
    }

    let elapsed = start.elapsed().as_millis() as u64;
    Ok((elapsed, total, status))
}

fn find_header_end(data: &[u8]) -> Option<usize> {
    for i in 0..data.len().saturating_sub(3) {
        if &data[i..i + 4] == b"\r\n\r\n" {
            return Some(i + 4);
        }
    }
    None
}

// ── TCP ping (layer 1) ─────────────────────────────────────────────

fn tcp_ping(host: &str, port: u16) -> Option<u64> {
    let start = Instant::now();
    let addr = format!("{}:{}", host, port).to_socket_addrs().ok()?.next()?;
    TcpStream::connect_timeout(&addr, Duration::from_secs(5))
        .ok()
        .map(|_| start.elapsed().as_millis() as u64)
}

// ── Main test command ───────────────────────────────────────────────

const LATENCY_URL: &str = "http://cp.cloudflare.com/";
const SPEED_URL: &str = "http://speed.cloudflare.com/__down?bytes=52428800"; // 50MB
const SPEED_TIMEOUT: u64 = 45;
const LATENCY_TIMEOUT: u64 = 10;

#[tauri::command]
pub async fn run_singbox_tests(
    app: AppHandle,
    outbounds: Vec<String>,
    speed_mb: Option<u64>,
) -> Result<Vec<ProxyTestResult>, String> {
    let mut results = Vec::new();
    let base_port = mixed_proxy_port(&app);
    let mb = speed_mb.unwrap_or(50).max(10).min(500);

    for (i, outbound_json) in outbounds.into_iter().enumerate() {
        let test_port: u16 = base_port + 10 + (i as u16 % 40);

        let parsed: serde_json::Value =
            serde_json::from_str(&outbound_json).map_err(|e| format!("json: {}", e))?;
        let server = parsed["server"].as_str().unwrap_or("unknown");
        let svr_port = parsed["server_port"].as_u64().unwrap_or(0) as u16;
        let tag = parsed["tag"].as_str().unwrap_or("test-node");

        // ── Layer 1: TCP ping (direct, no proxy) ────────────────────
        let tcp_ms = tcp_ping(server, svr_port);

        // ── Generate test config with proper DNS + routing ──────────
        let test_config = serde_json::json!({
            "log": { "disabled": true },
            "dns": {
                "servers": [
                    { "tag": "dns-direct", "address": "resolver", "detour": "direct" }
                ]
            },
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
                "auto_detect_interface": true,
                "default_domain_resolver": "dns-direct"
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
            .args(["run", "-c", &config_path, "--disable-color"]);

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
            cleanup(pid, &config_path);
            results.push(ProxyTestResult {
                server: server.into(),
                port: svr_port,
                tcp_ms,
                real_ms: None,
                speed_kbps: None,
                error: Some("sing-box start timeout".into()),
            });
            continue;
        }

        // Give sing-box a moment to fully initialise
        sleep(Duration::from_millis(500)).await;

        // ── Layer 2: Real HTTP latency through proxy chain ──────────
        let real_ms = match http_get_via_proxy(
            "127.0.0.1",
            test_port,
            LATENCY_URL,
            Duration::from_secs(LATENCY_TIMEOUT),
        ) {
            Ok((ms, _, code)) if code >= 200 && code < 400 => Some(ms),
            Ok((_, _, code)) => {
                log::warn!("[test] {} latency: HTTP {}", tag, code);
                None
            }
            Err(e) => {
                log::warn!("[test] {} latency failed: {}", tag, e);
                None
            }
        };

        // ── Layer 3: Speed test (real download through proxy) ───────
        let speed_kbps = {
            let url = if mb > 50 {
                format!(
                    "http://speed.cloudflare.com/__down?bytes={}",
                    mb * 1024 * 1024
                )
            } else {
                format!(
                    "http://speed.cloudflare.com/__down?bytes={}",
                    mb * 1024 * 1024
                )
            };
            match http_get_via_proxy(
                "127.0.0.1",
                test_port,
                &url,
                Duration::from_secs(SPEED_TIMEOUT),
            ) {
                Ok((elapsed_ms, bytes, code)) if code >= 200 && code < 400 && bytes > 0 => {
                    let secs = (elapsed_ms as f64) / 1000.0;
                    Some((bytes as f64) / 1024.0 / secs.max(0.5))
                }
                Ok((_, _, code)) => {
                    log::warn!("[test] {} speed: HTTP {} ({} bytes)", tag, code, 0);
                    None
                }
                Err(e) => {
                    log::warn!("[test] {} speed failed: {}", tag, e);
                    None
                }
            }
        };

        cleanup(pid, &config_path);

        let error = if real_ms.is_none() && speed_kbps.is_none() {
            Some("proxy chain unreachable".into())
        } else {
            None
        };

        results.push(ProxyTestResult {
            server: server.into(),
            port: svr_port,
            tcp_ms,
            real_ms,
            speed_kbps,
            error,
        });

        sleep(Duration::from_millis(200)).await;
    }

    Ok(results)
}

fn cleanup(pid: u32, config_path: &str) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
    std::thread::sleep(Duration::from_millis(200));
    unsafe {
        libc::kill(pid as i32, libc::SIGKILL);
    }
    let _ = std::fs::remove_file(config_path);
}
