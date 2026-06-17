//! Proxy server latency testing commands.

use std::net::ToSocketAddrs;
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::time::timeout;

/// Result of a TCP latency test to a single server.
#[derive(serde::Serialize, Clone)]
pub struct LatencyResult {
    pub server: String,
    pub port: u16,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

/// Test TCP connection latency to a list of servers.
/// Each connection attempt times out after 5 seconds.
/// Tests run in parallel via tokio::spawn.
#[tauri::command]
pub async fn test_tcp_latency(
    targets: Vec<(String, u16)>,
) -> Result<Vec<LatencyResult>, String> {
    let mut handles = Vec::new();

    for (host, port) in targets {
        handles.push(tokio::spawn(async move {
            let addr_str = format!("{}:{}", host, port);
            let start = Instant::now();

            let result = timeout(
                std::time::Duration::from_secs(5),
                async {
                    let addrs = tokio::task::spawn_blocking({
                        let addr_str = addr_str.clone();
                        move || addr_str.to_socket_addrs().ok()
                    })
                    .await
                    .ok()
                    .flatten();

                    let addrs = match addrs {
                        Some(a) => a,
                        None => return Err("dns_resolve_failed".to_string()),
                    };

                    for addr in addrs {
                        match TcpStream::connect(addr).await {
                            Ok(_) => return Ok(()),
                            Err(_) => continue,
                        }
                    }
                    Err("connection_refused".to_string())
                },
            )
            .await;

            let elapsed = start.elapsed();
            match result {
                Ok(Ok(_)) => LatencyResult {
                    server: host,
                    port,
                    latency_ms: Some(elapsed.as_millis() as u64),
                    error: None,
                },
                Ok(Err(e)) => LatencyResult {
                    server: host,
                    port,
                    latency_ms: None,
                    error: Some(e),
                },
                Err(_) => LatencyResult {
                    server: host,
                    port,
                    latency_ms: None,
                    error: Some("timeout".to_string()),
                },
            }
        }));
    }

    let mut results = Vec::new();
    for h in handles {
        match h.await {
            Ok(r) => results.push(r),
            Err(_) => {}
        }
    }
    Ok(results)
}
