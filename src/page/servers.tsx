import { useEffect, useState } from "react";
import useSWR from "swr";
import { CloudPlus, Clipboard, Pencil, Server, Speedometer2, Trash3 } from "react-bootstrap-icons";
import { addGroupMember, deleteProxyGroup, deleteProxyServer, getGroupMembers, getProxyGroups, getProxyServers, insertProxyGroup, removeGroupMember, setActiveProxyGroup, setActiveProxyServer } from "../action/db";
import { GET_PROXY_GROUPS_SWR_KEY, GET_PROXY_SERVERS_SWR_KEY } from "../types/definition";
import type { ProxyGroup, ProxyServer } from "../types/definition";
import { t } from "../utils/helper";
import { AddServerModal } from "../components/servers/add-server-modal";
import { ImportShareLinksModal } from "../components/servers/import-share-links-modal";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

type LatencyMap = Record<string, { ms: number | null; tcpMs?: number; error?: string }>;
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
  // Group management
  const { data: groups, mutate: mutateGroups } = useSWR(GET_PROXY_GROUPS_SWR_KEY, getProxyGroups, { fallbackData: [] });
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupType, setGroupType] = useState<"fixed"|"auto"|"random"|"chain">("fixed");
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<Record<string, any[]>>({});

  const refresh = () => mutate();

  // ── v2rayN-style paste-to-import ──────────────────────────────────
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      const text = e.clipboardData?.getData("text")?.trim();
      if (!text) return;
      const { parseProxyLink } = await import("../utils/shadowsocks-parser");
      const { batchInsertProxyServers } = await import("../action/db");
      const links = text.split("\n").map(l => l.trim()).filter(Boolean);
      const parsed = links.map(l => parseProxyLink(l)).filter(Boolean);
      const valid = parsed.filter((s): s is NonNullable<typeof s> => s != null);
      if (valid.length === 0) return;
      e.preventDefault();
      try {
        await batchInsertProxyServers(valid.map(s => ({
          name: s.name, server_address: s.server, server_port: s.port,
          password: s.password, encryption_method: s.method,
          plugin: s.plugin, plugin_opts: s.pluginOpts,
          proxy_type: s.proxyType || "ss", username: s.username || "",
          vless_uuid: (s as any).vlessUUID || "", vless_opts: s.vlessOpts ? JSON.stringify(s.vlessOpts) : "",
        })));
        toast.success(`已导入 ${valid.length} 个服务器`);
        refresh();
      } catch (err: any) { toast.error(String(err)); }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);
  const handleDelete = async (id: string) => { try { await deleteProxyServer(id); refresh(); } catch (e) { toast.error(String(e)); } };
  const handleSetActive = async (id: string) => { try { await setActiveProxyServer(id); refresh(); } catch (e) { toast.error(String(e)); } };
  const handleEdit = (s: ProxyServer) => { setEditServer(s); setAddVisible(true); };
  const handleAdd = () => { setEditServer(null); setAddVisible(true); };

  // ── v2rayN-style: rebuild share link from DB row ──────────────────
  const buildShareLink = (s: ProxyServer): string => {
    const ptype = s.proxy_type || "ss";
    const host = `${s.server_address}:${s.server_port}`;
    switch (ptype) {
      case "ss": {
        const userinfo = btoa(`${s.encryption_method}:${s.password}`);
        return `ss://${userinfo}@${host}#${encodeURIComponent(s.name)}`;
      }
      case "trojan":
        return `trojan://${encodeURIComponent(s.password)}@${host}?security=tls#${encodeURIComponent(s.name)}`;
      case "vless": {
        const uid = (s as any).vless_uuid || "";
        return `vless://${uid}@${host}?security=tls#${encodeURIComponent(s.name)}`;
      }
      case "hysteria2":
        return `hysteria2://${s.password}@${host}?sni=${s.server_address}&insecure=1#${encodeURIComponent(s.name)}`;
      case "socks5":
        return `socks5://${s.username ? s.username + ":" + s.password : ""}@${host}#${encodeURIComponent(s.name)}`;
      case "http":
        return `http://${s.username ? s.username + ":" + s.password : ""}@${host}#${encodeURIComponent(s.name)}`;
      default: return "";
    }
  };

  const handleCopyLink = async (s: ProxyServer) => {
    const link = buildShareLink(s);
    if (!link) return;
    try { await navigator.clipboard.writeText(link); toast.success("已复制"); } catch { toast.error("复制失败"); }
  };

  const handleExportLinks = async () => {
    if (!servers?.length) return;
    const links = servers.map(s => buildShareLink(s)).filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(links);
      toast.success(`已导出 ${servers.length} 个分享链接到剪贴板`);
    } catch { toast.error("复制失败"); }
  };

  // ── Group management ──────────────────────────────────────────────
  const handleCreateGroup = async () => {
    if (!groupName.trim()) return;
    try { await insertProxyGroup(groupName.trim(), groupType); mutateGroups(); setGroupName(""); setShowGroupForm(false); } catch (e: any) { toast.error(String(e)); }
  };
  const handleDeleteGroup = async (id: string) => { try { await deleteProxyGroup(id); mutateGroups(); } catch (e: any) { toast.error(String(e)); } };
  const handleToggleGroup = async (g: ProxyGroup) => {
    try { await setActiveProxyGroup(g.is_active ? null : g.identifier); mutateGroups(); } catch (e: any) { toast.error(String(e)); }
  };
  const handleLoadMembers = async (g: ProxyGroup) => {
    if (expandedGroupId === g.identifier) { setExpandedGroupId(null); return; }
    try {
      const members = await getGroupMembers(g.identifier);
      setGroupMembers(prev => ({ ...prev, [g.identifier]: members }));
      setExpandedGroupId(g.identifier);
    } catch (e: any) { toast.error(String(e)); }
  };
  const handleAddToGroup = async (g: ProxyGroup, s: ProxyServer) => {
    try {
      const members = await getGroupMembers(g.identifier);
      await addGroupMember(g.identifier, s.identifier, members.length);
      setGroupMembers(prev => ({ ...prev, [g.identifier]: [...(prev[g.identifier] || []), { server_identifier: s.identifier, sort_order: members.length }] }));
    } catch (e: any) { toast.error(String(e)); }
  };
  const handleRemoveFromGroup = async (g: ProxyGroup, serverId: string) => {
    try { await removeGroupMember(g.identifier, serverId); setGroupMembers(prev => ({ ...prev, [g.identifier]: (prev[g.identifier] || []).filter((m: any) => m.server_identifier !== serverId) })); } catch (e: any) { toast.error(String(e)); }
  };
  const handleReorderMember = async (g: ProxyGroup, serverId: string, direction: "up" | "down") => {
    const members = groupMembers[g.identifier] || [];
    const idx = members.findIndex((m: any) => m.server_identifier === serverId);
    if (idx === -1) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= members.length) return;
    const reordered = [...members];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    // Update sort_order in DB
    try {
      for (let i = 0; i < reordered.length; i++) {
        await addGroupMember(g.identifier, reordered[i].server_identifier, i);
      }
      setGroupMembers(prev => ({ ...prev, [g.identifier]: reordered }));
    } catch (e: any) { toast.error(String(e)); }
  };
  const GROUP_TYPE_LABELS: Record<string, string> = { fixed: "手动选择", auto: "自动最优", random: "随机切换", chain: "链路代理" };
  const GROUP_TYPE_TIPS: Record<string, string> = {
    fixed: "选择一个固定的代理使用",
    auto: "自动选择延迟最低的代理",
    random: "每次启动随机选择一个代理",
    chain: "流量按顺序经过每个代理 (1→2→3)"
  };

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

  // ── v2rayN-style 3-layer test ─────────────────────────────────────
  const runTests = async (s: ProxyServer, mode: "latency" | "speed") => {
    const outbounds = [buildOutboundJSON(s)];
    const isLatency = mode === "latency";
    const setTesting = isLatency ? setTestingLatency : setTestingSpeed;
    const setMap: any = isLatency ? setLatencyMap : setSpeedMap;
    const key = `${s.server_address}:${s.server_port}`;
    setTesting(prev => new Set([...prev, key]));

    try {
      const results = await invoke<{
        server: string; port: number;
        tcp_ms: number | null; real_ms: number | null; speed_kbps: number | null; error: string | null;
      }[]>("run_singbox_tests", { outbounds });

      if (isLatency) {
        setMap((prev: any) => ({ ...prev, [key]: { ms: results[0]?.real_ms ?? null, tcpMs: results[0]?.tcp_ms ?? undefined, error: results[0]?.error ?? undefined } }));
      } else {
        setMap((prev: any) => ({ ...prev, [key]: { kbps: results[0]?.speed_kbps ? Math.round(results[0].speed_kbps) : null, error: !results[0]?.speed_kbps ? (results[0]?.error ?? undefined) : undefined } }));
      }
    } catch (e) { toast.error(String(e)); } finally {
      setTesting(prev => { const n = new Set(prev); n.delete(key); return n; });
    }
  };

  const runTestsBatch = async (mode: "latency" | "speed") => {
    if (!servers?.length) return;
    const outbounds = servers.map(s => buildOutboundJSON(s));
    const isLatency = mode === "latency";
    const setTesting = isLatency ? setTestingLatency : setTestingSpeed;
    const setMap: any = isLatency ? setLatencyMap : setSpeedMap;
    const keys = servers.map(s => `${s.server_address}:${s.server_port}`);
    setTesting(prev => { const n = new Set(prev); keys.forEach(k => n.add(k)); return n; });

    try {
      const results = await invoke<{
        server: string; port: number;
        tcp_ms: number | null; real_ms: number | null; speed_kbps: number | null; error: string | null;
      }[]>("run_singbox_tests", { outbounds });
      setMap((prev: any) => {
        const next = { ...prev };
        for (const r of results) {
          const k = `${r.server}:${r.port}`;
          if (isLatency) next[k] = { ms: r.real_ms, tcpMs: r.tcp_ms ?? undefined, error: r.error ?? undefined };
          else next[k] = { kbps: r.speed_kbps ? Math.round(r.speed_kbps) : null, error: !r.speed_kbps ? (r.error ?? undefined) : undefined };
        }
        return next;
      });
    } catch (e) { toast.error(String(e)); } finally {
      setTesting(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
    }
  };

  const isTesting = (s: ProxyServer, mode: "latency" | "speed") => {
    const set = mode === "latency" ? testingLatency : testingSpeed;
    return set.has(`${s.server_address}:${s.server_port}`);
  };

  // ── Display helpers ───────────────────────────────────────────────
  const delayColor = (ms: number | null | undefined) => {
    if (ms == null) return "var(--aurorabox-label-tertiary)";
    if (ms < 200) return "var(--aurorabox-green)";
    if (ms < 500) return "var(--aurorabox-orange)";
    return "var(--aurorabox-red)";
  };
  const speedText = (kbps: number | null | undefined) => {
    if (kbps == null) return "—";
    if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
    return `${kbps} KB/s`;
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
          <button onClick={handleExportLinks} disabled={!servers?.length}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
            {t("export_links")}
          </button>
          <button onClick={() => runTestsBatch("latency")} disabled={testingLatency.size > 0 || !servers?.length}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
            <span className={testingLatency.size > 0 ? "animate-pulse" : ""}>⏱</span>
            {testingLatency.size > 0 ? t("testing") : t("test_latency")}
          </button>
          <button onClick={() => runTestsBatch("speed")} disabled={testingSpeed.size > 0 || !servers?.length}
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
                    {lTesting && <span className="text-xs animate-pulse">⏳</span>}
                    {latency && !lTesting && latency.tcpMs != null && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: "var(--aurorabox-label-tertiary)", background: "var(--aurorabox-fill)" }}>TCP {latency.tcpMs}ms</span>
                    )}
                    {latency && !lTesting && latency.ms != null && (
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded" style={{ color: delayColor(latency.ms), background: "var(--aurorabox-fill)" }}>{latency.ms}ms</span>
                    )}
                    {latency && !lTesting && latency.ms == null && latency.error && (
                      <span className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ color: "var(--aurorabox-red)", background: "var(--aurorabox-fill)" }}>FAIL</span>
                    )}
                    {sTesting && <span className="text-xs animate-pulse">⏳</span>}
                    {speed && !sTesting && speed.kbps != null && (
                      <span className="text-xs font-mono font-medium px-2 py-0.5 rounded" style={{ color: "var(--aurorabox-blue)", background: "var(--aurorabox-fill)" }}>{speedText(speed.kbps)}</span>
                    )}
                    {speed && !sTesting && speed.error && (
                      <span className="text-[10px] font-mono px-1 py-0.5 rounded" style={{ color: "var(--aurorabox-red)", background: "var(--aurorabox-fill)" }}>FAIL</span>
                    )}
                  </div>
                  {s.plugin && <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label-secondary)] flex-shrink-0">plugin</span>}
                </button>

                {expandedId === s.identifier && (
                  <div className="flex gap-1 px-4 pb-3 flex-wrap">
                    {!s.is_active && <button onClick={() => handleSetActive(s.identifier)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-green)]/10 text-[var(--aurorabox-green)] hover:brightness-95">{t("set_active")}</button>}
                    {s.is_active && <span className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-green)]/10 text-[var(--aurorabox-green)]">{t("active")}</span>}
                    <button onClick={() => runTests(s, "latency")} disabled={isTesting(s, "latency")}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
                      ⏱ {isTesting(s, "latency") ? "..." : t("test_latency")}
                    </button>
                    <button onClick={() => runTests(s, "speed")} disabled={isTesting(s, "speed")}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50">
                      <Speedometer2 size={12} /> {isTesting(s, "speed") ? "..." : t("test_speed")}
                    </button>
                    <button onClick={() => handleCopyLink(s)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"><Clipboard size={12} /> 复制</button>
                    <button onClick={() => handleEdit(s)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"><Pencil size={12} /> {t("edit")}</button>
                    <button onClick={() => handleDelete(s.identifier)} className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-red)]/10 text-[var(--aurorabox-red)] hover:brightness-95"><Trash3 size={12} /> {t("delete")}</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Groups Section ──────────────────────────────────── */}
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-lg font-semibold text-[var(--aurorabox-label)]">代理组</h3>
            <button onClick={() => setShowGroupForm(!showGroupForm)}
              className="text-xs px-2 py-1 rounded bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label-secondary)] hover:brightness-95">
              {showGroupForm ? "取消" : "+ 新建"}
            </button>
          </div>
          {showGroupForm && (
            <div className="flex gap-2 mb-3 flex-wrap items-center p-3 rounded-lg bg-[var(--aurorabox-fill)]">
              <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="组名称" className="px-3 py-1.5 text-sm rounded bg-[var(--aurorabox-card)] border border-[var(--aurorabox-separator)] text-[var(--aurorabox-label)] w-32" />
              <select value={groupType} onChange={e => setGroupType(e.target.value as any)} className="px-3 py-1.5 text-sm rounded bg-[var(--aurorabox-card)] border border-[var(--aurorabox-separator)] text-[var(--aurorabox-label)]">
                <option value="fixed">固定</option><option value="auto">自动</option><option value="random">随机</option><option value="chain">链路</option>
              </select>
              <button onClick={handleCreateGroup} className="px-3 py-1.5 text-sm rounded bg-[var(--aurorabox-blue)] text-white">创建</button>
            </div>
          )}
          {(groups ?? []).map(g => (
            <div key={g.identifier} className="mb-2 border border-[var(--aurorabox-separator)] rounded-lg bg-[var(--aurorabox-card)]">
              <div className="flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-[var(--aurorabox-row-hover)]" onClick={() => handleLoadMembers(g)}>
                <div className={`w-2.5 h-2.5 rounded-full ${g.is_active ? "bg-[var(--aurorabox-green)]" : "bg-[var(--aurorabox-fill-strong)]"}`} />
                <span className="font-medium text-sm text-[var(--aurorabox-label)]">{g.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--aurorabox-blue)]/10 text-[var(--aurorabox-blue)]">{GROUP_TYPE_LABELS[g.group_type] || g.group_type}</span>
                <div className="flex-1" />
                <button onClick={(e) => { e.stopPropagation(); handleToggleGroup(g); }} className="text-[10px] px-2 py-1 rounded bg-[var(--aurorabox-fill)]">{g.is_active ? "取消" : "激活"}</button>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.identifier); }} className="text-[10px] px-2 py-1 rounded bg-[var(--aurorabox-red)]/10 text-[var(--aurorabox-red)]">删除</button>
              </div>
              {expandedGroupId === g.identifier && (
                <div className="px-4 pb-3 border-t border-[var(--aurorabox-separator)] pt-2">
                  <p className="text-xs text-[var(--aurorabox-label-secondary)] mb-3">{GROUP_TYPE_TIPS[g.group_type]}</p>
                  {/* Members with mode-specific controls */}
                  <div className="space-y-1">
                    {(groupMembers[g.identifier] || []).map((m: any, idx: number) => {
                      const svr = (servers || []).find(s => s.identifier === m.server_identifier);
                      if (!svr) return null;
                      const isFirst = idx === 0;
                      const isLast = idx === (groupMembers[g.identifier] || []).length - 1;
                      return (
                        <div key={m.server_identifier} className="flex items-center gap-2 py-1.5 text-xs rounded px-2 hover:bg-[var(--aurorabox-row-hover)]">
                          {/* Chain: order number */}
                          {g.group_type === "chain" && <span className="w-5 text-center font-mono text-[var(--aurorabox-label-tertiary)]">{idx + 1}</span>}
                          {/* Fixed: radio to pick default */}
                          {g.group_type === "fixed" && (
                            <input type="radio" name={`gp-${g.identifier}`} checked={isFirst}
                              onChange={() => {/* move to front via reorder */}}
                              className="w-3.5 h-3.5 accent-[var(--aurorabox-blue)]" />
                          )}
                          <span className="truncate flex-1 text-[var(--aurorabox-label)]">
                            {svr.name} <span className="text-[var(--aurorabox-label-tertiary)]">({svr.server_address}:{svr.server_port})</span>
                          </span>
                          {/* Chain: reorder buttons */}
                          {g.group_type === "chain" && (
                            <div className="flex gap-0.5">
                              <button onClick={() => handleReorderMember(g, m.server_identifier, "up")} disabled={isFirst}
                                className="text-[10px] px-1.5 rounded disabled:opacity-30 hover:bg-[var(--aurorabox-fill)]">▲</button>
                              <button onClick={() => handleReorderMember(g, m.server_identifier, "down")} disabled={isLast}
                                className="text-[10px] px-1.5 rounded disabled:opacity-30 hover:bg-[var(--aurorabox-fill)]">▼</button>
                            </div>
                          )}
                          <button onClick={() => handleRemoveFromGroup(g, m.server_identifier)} className="text-[var(--aurorabox-red)] hover:brightness-75">✕</button>
                        </div>
                      );
                    })}
                    {(!groupMembers[g.identifier] || groupMembers[g.identifier].length === 0) && (
                      <p className="text-xs text-[var(--aurorabox-label-tertiary)] py-2 text-center">暂无成员，从下方添加</p>
                    )}
                  </div>
                  {/* Add server buttons */}
                  <div className="mt-3 flex flex-wrap gap-1">
                    {(servers || []).filter(s => !(groupMembers[g.identifier] || []).some((m: any) => m.server_identifier === s.identifier)).map(s => (
                      <button key={s.identifier} onClick={() => handleAddToGroup(g, s)}
                        className="text-[10px] px-2 py-1 rounded bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label-secondary)] hover:brightness-95">+ {s.name}</button>
                    ))}
                    {(servers || []).filter(s => !(groupMembers[g.identifier] || []).some((m: any) => m.server_identifier === s.identifier)).length === 0 && (
                      <span className="text-[10px] text-[var(--aurorabox-label-tertiary)]">所有服务器已加入此组</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <AddServerModal visible={addVisible} editServer={editServer} onClose={() => setAddVisible(false)} onSaved={refresh} />
      <ImportShareLinksModal visible={importVisible} onClose={() => setImportVisible(false)} onImported={refresh} />
    </div>
  );
}

export default ServersPage;
