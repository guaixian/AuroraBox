import { useState } from "react";
import useSWR from "swr";
import { CloudPlus, LightningCharge, Pencil, Server, Speedometer2, Trash3 } from "react-bootstrap-icons";
import { deleteProxyServer, getProxyServers, setActiveProxyServer } from "../action/db";
import { GET_PROXY_SERVERS_SWR_KEY } from "../types/definition";
import type { ProxyServer } from "../types/definition";
import { t } from "../utils/helper";
import { AddServerModal } from "../components/servers/add-server-modal";
import { ImportShareLinksModal } from "../components/servers/import-share-links-modal";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

type LatencyMap = Record<string, { ms: number | null; error?: string }>;
type SpeedMap = Record<string, { kbps: number | null; error?: string }>;

function ServersPage() {
  const { data: servers, mutate } = useSWR(GET_PROXY_SERVERS_SWR_KEY, getProxyServers, { fallbackData: [] });
  const [addVisible, setAddVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [editServer, setEditServer] = useState<ProxyServer | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [latencyMap, setLatencyMap] = useState<LatencyMap>({});
  const [speedMap, setSpeedMap] = useState<SpeedMap>({});
  const [testingLatency, setTestingLatency] = useState<Set<string>>(new Set());
  const [testingSpeed, setTestingSpeed] = useState<Set<string>>(new Set());

  const refresh = () => mutate();
  const handleDelete = async (id: string) => { try { await deleteProxyServer(id); refresh(); } catch (e) { toast.error(String(e)); } };
  const handleSetActive = async (id: string) => { try { await setActiveProxyServer(id); refresh(); } catch (e) { toast.error(String(e)); } };
  const handleEdit = (s: ProxyServer) => { setEditServer(s); setAddVisible(true); };
  const handleAdd = () => { setEditServer(null); setAddVisible(true); };

  // ── Build outbound JSON ───────────────────────────────────────────
  const buildOutboundJSON = (s: ProxyServer): string => {
    const ptype = s.proxy_type || "ss";
    const tag = `${ptype}-${(s as any).identifier?.slice(0, 8) || "00000000"}`;
    const base: any = { tag, server: s.server_address, server_port: s.server_port, domain_resolver: "system" };
    switch (ptype) {
      case "hysteria2":
        base.type = "hysteria2"; base.password = s.password;
        const hops = (() => { try { return JSON.parse((s as any).vless_opts || "{}"); } catch { return {}; } })();
        base.tls = { enabled: true, server_name: hops.sni || s.server_address, insecure: hops.insecure === "1" || hops.allowInsecure === "1" };
        if (hops.obfs) base.obfs = { type: "salamander", password: hops.obfs };
        break;
      case "trojan": case "vless":
        base.type = ptype;
        if (ptype === "vless") base.uuid = (s as any).vless_uuid || "";
        else base.password = s.password;
        const vopts = (() => { try { return JSON.parse((s as any).vless_opts || "{}"); } catch { return {}; } })();
        base.tls = { enabled: vopts.security !== "none", server_name: vopts.sni || "" };
        break;
      case "socks5": base.type = "socks"; base.version = "5"; break;
      case "http": base.type = "http"; break;
      default: base.type = "shadowsocks"; base.method = s.encryption_method; base.password = s.password; break;
    }
    return JSON.stringify(base);
  };

  // ── Generic test runner ───────────────────────────────────────────
  const runTests = async (targets: ProxyServer[], mode: "latency" | "speed") => {
    const outbounds = targets.map(s => buildOutboundJSON(s));
    const isLatency = mode === "latency";
    const setTesting = isLatency ? setTestingLatency : setTestingSpeed;
    const setMap = isLatency ? setLatencyMap : setSpeedMap;

    // Mark these servers as testing
    const keys = targets.map(s => `${s.server_address}:${s.server_port}`);
    setTesting(prev => { const n = new Set(prev); keys.forEach(k => n.add(k)); return n; });

    try {
      const results = await invoke<{
        server: string; port: number;
        latency_ms: number | null; speed_kbps: number | null; error: string | null;
      }[]>("run_singbox_tests", { outbounds, speedMb: isLatency ? 10 : 200 });

      setMap((prev: any) => {
        const next = { ...prev };
        for (const r of results) {
          const key = `${r.server}:${r.port}`;
          if (isLatency) {
            next[key] = { ms: r.latency_ms, error: r.error ?? undefined };
          } else {
            next[key] = { kbps: r.speed_kbps ? Math.round(r.speed_kbps) : null, error: r.error ?? undefined };
          }
        }
        return next;
      });
    } catch (e) { toast.error(String(e)); } finally {
      setTesting(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
    }
  };

  const testLatencyAll = () => servers?.length && runTests(servers, "latency");
  const testSpeedAll = () => servers?.length && runTests(servers, "speed");
  const testLatencyOne = (s: ProxyServer) => runTests([s], "latency");
  const testSpeedOne = (s: ProxyServer) => runTests([s], "speed");

  const isTesting = (s: ProxyServer, mode: "latency" | "speed") => {
    const set = mode === "latency" ? testingLatency : testingSpeed;
    return set.has(`${s.server_address}:${s.server_port}`);
  };

  // ── Display helpers ───────────────────────────────────────────────
  const latencyColor = (ms: number | null | undefined) => {
    if (ms == null) return "var(--aurorabox-label-tertiary)";
    if (ms < 150) return "var(--aurorabox-green)";
    if (ms < 350) return "var(--aurorabox-orange)";
    return "var(--aurorabox-red)";
  };
  const latencyText = (ms: number | null | undefined, error?: string) => {
    if (error) return error === "timeout" ? "超时" : error.length > 12 ? error.slice(0, 12) : error;
    if (ms == null) return "—";
    return `${ms}ms`;
  };

  return (
    <div className="aurorabox-scrollpage">
      <div className="aurorabox-page-inner px-4 pt-6 pb-4">
        <h2 className="text-[22px] font-semibold text-[var(--aurorabox-label)] mb-1">{t("servers")}</h2>
        <p className="text-sm text-[var(--aurorabox-label-secondary)] mb-4">{t("servers_description")}</p>

        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={handleAdd} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-blue)] text-white hover:brightness-110">
            <CloudPlus size={16} /> {t("add_server")}
          </button>
          <button onClick={() => setImportVisible(true)} className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95">
            {t("batch_import")}
          </button>
          <button onClick={testLatencyAll} disabled={testingLatency.size > 0 || !servers?.length}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
            <LightningCharge size={16} className={testingLatency.size > 0 ? "animate-pulse" : ""} />
            {testingLatency.size > 0 ? t("testing") : t("test_latency")}
          </button>
          <button onClick={testSpeedAll} disabled={testingSpeed.size > 0 || !servers?.length}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
            <Speedometer2 size={16} className={testingSpeed.size > 0 ? "animate-pulse" : ""} />
            {testingSpeed.size > 0 ? t("testing") : t("test_speed")}
          </button>
        </div>

        {(!servers || servers.length === 0) && (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--aurorabox-label-tertiary)]">
            <Server size={48} className="mb-3 opacity-40" /><p className="text-sm">{t("no_servers_yet")}</p>
            <button onClick={handleAdd} className="mt-3 px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95">{t("add_first_server")}</button>
          </div>
        )}

        <div className="aurorabox-grouped-card">
          {(servers ?? []).map((s) => {
            const lkey = `${s.server_address}:${s.server_port}`;
            const latency = latencyMap[lkey];
            const speed = speedMap[lkey];
            const lTesting = isTesting(s, "latency");
            const sTesting = isTesting(s, "speed");
            return (
              <div key={s.identifier} className="border-b border-[var(--aurorabox-separator)] last:border-b-0">
                <button onClick={() => setExpandedId(expandedId === s.identifier ? null : s.identifier)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--aurorabox-row-hover)] transition-colors">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.is_active ? "bg-[var(--aurorabox-green)]" : "bg-[var(--aurorabox-fill-strong)]"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-[var(--aurorabox-label)] text-sm truncate">{s.name}</div>
                    <div className="text-xs text-[var(--aurorabox-label-secondary)] font-mono truncate">
                      {s.server_address}:{s.server_port} · {(s as any).proxy_type === 'socks5' ? 'SOCKS5' : (s as any).proxy_type === 'http' ? 'HTTP' : (s as any).proxy_type === 'vless' ? 'VLESS' : (s as any).proxy_type === 'trojan' ? 'Trojan' : (s as any).proxy_type === 'hysteria2' ? 'Hysteria2' : s.encryption_method}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {lTesting && <span className="text-xs text-[var(--aurorabox-blue)]">⏳</span>}
                    {latency && !lTesting && (
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded" style={{ color: latencyColor(latency.ms), background: "var(--aurorabox-fill)" }}>
                        {latencyText(latency.ms, latency.error)}
                      </span>
                    )}
                    {sTesting && <span className="text-xs text-[var(--aurorabox-blue)]">⏳</span>}
                    {speed && !sTesting && speed.kbps != null && (
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded" style={{ color: "var(--aurorabox-blue)", background: "var(--aurorabox-fill)" }}>
                        {speed.kbps >= 1024 ? `${(speed.kbps / 1024).toFixed(1)} MB/s` : `${speed.kbps} KB/s`}
                      </span>
                    )}
                    {speed && !sTesting && speed.error && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded" style={{ color: "var(--aurorabox-label-tertiary)", background: "var(--aurorabox-fill)" }}>{speed.error.length > 12 ? speed.error.slice(0, 12) : speed.error}</span>
                    )}
                  </div>
                  {s.plugin && <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label-secondary)] flex-shrink-0">plugin</span>}
                </button>

                {expandedId === s.identifier && (
                  <div className="flex gap-1 px-4 pb-3 flex-wrap">
                    {!s.is_active && <button onClick={() => handleSetActive(s.identifier)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-green)]/10 text-[var(--aurorabox-green)] hover:brightness-95">{t("set_active")}</button>}
                    {s.is_active && <span className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-green)]/10 text-[var(--aurorabox-green)]">{t("active")}</span>}
                    <button onClick={() => testLatencyOne(s)} disabled={lTesting}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
                      <LightningCharge size={12} /> {lTesting ? "..." : t("test_latency")}
                    </button>
                    <button onClick={() => testSpeedOne(s)} disabled={sTesting}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
                      <Speedometer2 size={12} /> {sTesting ? "..." : t("test_speed")}
                    </button>
                    <button onClick={() => handleEdit(s)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"><Pencil size={12} /> {t("edit")}</button>
                    <button onClick={() => handleDelete(s.identifier)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-red)]/10 text-[var(--aurorabox-red)] hover:brightness-95"><Trash3 size={12} /> {t("delete")}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <AddServerModal visible={addVisible} editServer={editServer} onClose={() => setAddVisible(false)} onSaved={refresh} />
      <ImportShareLinksModal visible={importVisible} onClose={() => setImportVisible(false)} onImported={refresh} />
    </div>
  );
}

export default ServersPage;
