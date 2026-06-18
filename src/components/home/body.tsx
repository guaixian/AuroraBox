import { useEffect, useState } from "react";
import useSWR from "swr";
import { ChevronDown } from "react-bootstrap-icons";
import { getProxyGroups, getGroupMembers, setActiveProxyGroup, getProxyServers, setActiveProxyServer } from "../../action/db";
import { GET_PROXY_GROUPS_SWR_KEY } from "../../types/definition";
import type { ProxyGroup } from "../../types/definition";
import { vpnServiceManager } from "../../utils/helper";
import { AppleNetworkStatus, GoogleNetworkStatus } from "./network-check";
import NetworkSpeed from "./network-speed";

const GROUP_LABELS: Record<string, string> = { fixed: "手动选择", auto: "自动最优", random: "随机", chain: "链路" };

function SectionLabel({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 mb-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] capitalize"
        style={{ color: 'var(--aurorabox-label-secondary)' }}>{children}</span>
      {trailing && <div className="flex items-center gap-2">{trailing}</div>}
    </div>
  );
}

export default function Body({ isRunning, onUpdate }: { isRunning: boolean; onUpdate: () => void }) {
  const { data: groups } = useSWR(GET_PROXY_GROUPS_SWR_KEY, getProxyGroups, { fallbackData: [] });
  const [open, setOpen] = useState(false);
  const [allServers, setAllServers] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  // true = "全部节点" virtual mode, false = using a real group
  const [allNodesMode, setAllNodesMode] = useState(true);
  const active = (groups || []).find(g => g.is_active);

  // Load all servers on mount and refresh when groups change
  useEffect(() => {
    getProxyServers().then(setAllServers);
  }, [groups]);

  const reloadMembers = async () => {
    if (!active) {
      setAllNodesMode(true);
      setMembers([]);
      return;
    }
    const m = await getGroupMembers(active.identifier);
    setMembers(m);
    if (m.length > 0) setSelectedId(prev => prev && m.some((x: any) => x.server_identifier === prev) ? prev : m[0].server_identifier);
  };

  // When active group changes, reload members
  useEffect(() => { reloadMembers(); }, [active?.identifier]);

  // Listen for member changes from servers page
  useEffect(() => {
    const handler = () => reloadMembers();
    window.addEventListener("group-members-changed", handler);
    return () => window.removeEventListener("group-members-changed", handler);
  }, [active?.identifier]);

  // ── Switch to "全部节点" mode ─────────────────────────────────────
  const handleSelectAllNodes = async () => {
    setOpen(false);
    if (allNodesMode && !active) return;
    setSwitching(true);
    try {
      if (active) {
        await setActiveProxyGroup(null);
        // useSWR + effect will pick up the change and set allNodesMode=true
      }
      setAllNodesMode(true);
      setMembers([]);
      const s = await getProxyServers();
      setAllServers(s);
      const act = s.find((x: any) => x.is_active);
      setSelectedId(act?.identifier || null);
    } catch (e) { console.error(e); } finally { setSwitching(false); }
  };

  // ── Switch to a real group ────────────────────────────────────────
  const handleSelectGroup = async (g: ProxyGroup) => {
    setOpen(false);
    if (g.is_active && !allNodesMode) return;
    setSwitching(true);
    try {
      await setActiveProxyGroup(g.identifier);
      // useEffect will pick up the active change and load members
      // Pre-load immediately for responsiveness
      const m = await getGroupMembers(g.identifier);
      const s = await getProxyServers();
      setAllServers(s);
      setAllNodesMode(false);
      setMembers(m);
      if (m.length > 0) setSelectedId(m[0].server_identifier);
      await vpnServiceManager.syncConfig({});
      onUpdate();
    } catch (e) { console.error(e); } finally { setSwitching(false); }
  };

  // ── Pick a node ──────────────────────────────────────────────────
  const handleSelectNode = async (serverId: string) => {
    if (serverId === selectedId || switching) return;
    const prev = selectedId;
    setSelectedId(serverId);
    try {
      if (allNodesMode) {
        // Use per-server activation (setActiveProxyServer)
        await setActiveProxyServer(serverId);
      } else if (active && active.group_type === "fixed") {
        // Reorder group members so selected is first
        const idx = members.findIndex(m => m.server_identifier === serverId);
        if (idx < 0) return;
        const reordered = [...members];
        const [item] = reordered.splice(idx, 1);
        reordered.unshift(item);
        const { removeGroupMember, addGroupMember } = await import("../../action/db");
        for (const m of members) await removeGroupMember(active.identifier, m.server_identifier);
        for (let i = 0; i < reordered.length; i++) {
          await addGroupMember(active.identifier, reordered[i].server_identifier, i);
        }
        setMembers(reordered);
      }
      await vpnServiceManager.syncConfig({});
      if (isRunning) onUpdate();
    } catch (e) { console.error(e); setSelectedId(prev); }
  };

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);

  // Nodes to display: in allNodesMode show all, otherwise group members
  const displayedNodes = allNodesMode
    ? allServers
    : members.map(m => allServers.find(s => s.identifier === m.server_identifier)).filter(Boolean);

  const canPickNode = allNodesMode || active?.group_type === "fixed";
  const groupLabel = allNodesMode ? "全部节点" : (active ? active.name : "全部节点");
  const groupTypeLabel = allNodesMode ? "自由选择" : (active ? (GROUP_LABELS[active.group_type] || active.group_type) : "");

  return (
    <div className="w-full space-y-4">
      {/* Group Selector */}
      <section className="w-full">
        <SectionLabel trailing={<><AppleNetworkStatus /><GoogleNetworkStatus isRunning={isRunning} /></>}>
          代理组
        </SectionLabel>
        <div className="relative">
          <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} disabled={switching}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--aurorabox-fill)", color: "var(--aurorabox-label)" }}>
            <span className="flex-1 text-left truncate">
              {groupLabel}
              <span className="text-[var(--aurorabox-label-tertiary)] text-xs ml-1">({groupTypeLabel})</span>
            </span>
            <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div className="absolute z-20 mt-1 w-full rounded-xl py-1 shadow-lg border border-[var(--aurorabox-separator)] max-h-56 overflow-y-auto"
              style={{ background: "var(--aurorabox-card)" }}>
              {/* Default: 全部节点 */}
              <button onClick={(e) => { e.stopPropagation(); handleSelectAllNodes(); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--aurorabox-row-hover)] border-b border-[var(--aurorabox-separator)]"
                style={{ color: (allNodesMode && !active) ? "var(--aurorabox-blue)" : "var(--aurorabox-label)" }}>
                <span className="flex-1 text-left">全部节点</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--aurorabox-fill)" }}>默认</span>
                {(allNodesMode && !active) && <span className="w-2 h-2 rounded-full bg-[var(--aurorabox-green)]" />}
              </button>
              {/* Custom groups */}
              {(groups || []).map(g => (
                <button key={g.identifier} onClick={(e) => { e.stopPropagation(); handleSelectGroup(g); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--aurorabox-row-hover)]"
                  style={{ color: (g.is_active && !allNodesMode) ? "var(--aurorabox-blue)" : "var(--aurorabox-label)" }}>
                  <span className="flex-1 text-left truncate">{g.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--aurorabox-fill)" }}>{GROUP_LABELS[g.group_type] || g.group_type}</span>
                  {(g.is_active && !allNodesMode) && <span className="w-2 h-2 rounded-full bg-[var(--aurorabox-green)]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Node List */}
      <section className="w-full">
        <SectionLabel>
          节点
          <span className="text-[10px] font-normal text-[var(--aurorabox-label-tertiary)] ml-1">
            {allNodesMode ? "— 自由选择任意节点" : active ? `— ${GROUP_LABELS[active.group_type] || ""}` : ""}
          </span>
        </SectionLabel>

        {canPickNode && (
          <div className="space-y-0.5 max-h-60 overflow-y-auto">
            {displayedNodes.map((svr: any) => {
              const isSelected = svr.identifier === selectedId;
              return (
                <button key={svr.identifier} onClick={() => handleSelectNode(svr.identifier)} disabled={switching}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--aurorabox-row-hover)] transition-colors disabled:opacity-50"
                  style={{ color: isSelected ? "var(--aurorabox-blue)" : "var(--aurorabox-label)" }}>
                  <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
                    isSelected ? "border-[var(--aurorabox-blue)] bg-[var(--aurorabox-blue)]" : "border-[var(--aurorabox-fill-strong)]"
                  }`} />
                  <span className="flex-1 text-left truncate">{svr.name}</span>
                  <span className="text-[10px] text-[var(--aurorabox-label-tertiary)]">
                    {(svr.proxy_type || "ss").toUpperCase()} · {(svr.server_address || "").split(".").slice(0, 2).join(".")}...
                  </span>
                </button>
              );
            })}
            {displayedNodes.length === 0 && (
              <p className="text-xs text-[var(--aurorabox-label-tertiary)] px-1 py-2 text-center">
                {allNodesMode ? "还没有服务器，去 Servers 页面添加" : "组内暂无成员"}
              </p>
            )}
          </div>
        )}

        {!canPickNode && (
          <div className="px-3 py-4 rounded-xl text-center" style={{ background: "var(--aurorabox-fill)" }}>
            <p className="text-xs text-[var(--aurorabox-label-tertiary)]">
              {active?.group_type === "auto" && "节点自动切换 — sing-box URlTest 实时选最优"}
              {active?.group_type === "random" && "节点随机切换 — 每次连接随机选一个"}
              {active?.group_type === "chain" && `链路模式 — 流量按序经过 ${members.length} 个节点`}
            </p>
          </div>
        )}
      </section>

      <NetworkSpeed isRunning={isRunning} />
    </div>
  );
}
