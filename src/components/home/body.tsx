import { useEffect, useState, useCallback } from "react";
import useSWR from "swr";
import { ChevronDown } from "react-bootstrap-icons";
import { getProxyGroups, getGroupMembers, setActiveProxyGroup, getProxyServers } from "../../action/db";
import { GET_PROXY_GROUPS_SWR_KEY } from "../../types/definition";
import type { ProxyGroup } from "../../types/definition";
import { vpnServiceManager } from "../../utils/helper";
import { AppleNetworkStatus, GoogleNetworkStatus } from "./network-check";
import NetworkSpeed from "./network-speed";

const GROUP_LABELS: Record<string, string> = { fixed: "手动选择", auto: "自动最优", random: "随机", chain: "链路" };
const GROUP_DESC: Record<string, string> = {
  fixed: "手动选择节点",
  auto: "自动选延迟最低的节点",
  random: "每次随机选节点",
  chain: "1→2→3 链路代理"
};

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
  const [members, setMembers] = useState<any[]>([]);
  const [servers, setServers] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const active = (groups || []).find(g => g.is_active);

  // Load members when active group changes
  const loadMembers = useCallback(async () => {
    if (!active) { setMembers([]); setServers([]); setSelectedId(null); return; }
    const m = await getGroupMembers(active.identifier);
    const allServers = await getProxyServers();
    setServers(allServers);
    setMembers(m);
    // Fixed mode: first member is the selected/default one
    if (m.length > 0) setSelectedId(m[0].server_identifier);
    else setSelectedId(null);
  }, [active?.identifier]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  // ── Switch group ──────────────────────────────────────────────────
  const handleSelectGroup = async (g: ProxyGroup) => {
    setOpen(false);
    if (g.is_active) return;
    setSwitching(true);
    try {
      await setActiveProxyGroup(g.identifier);
      await vpnServiceManager.syncConfig({});
      onUpdate();
      // Reload members for new group
      const m = await getGroupMembers(g.identifier);
      const allServers = await getProxyServers();
      setServers(allServers);
      setMembers(m);
      if (m.length > 0) setSelectedId(m[0].server_identifier);
    } catch (e) { console.error(e); } finally { setSwitching(false); }
  };

  // ── Switch node (fixed mode) ─────────────────────────────────────
  const handleSelectNode = async (serverId: string) => {
    if (!active || active.group_type !== "fixed" || switching) return;
    if (serverId === selectedId) return;
    // Optimistic UI update
    setSelectedId(serverId);
    try {
      // Move selected to front of sort_order
      const idx = members.findIndex(m => m.server_identifier === serverId);
      if (idx < 0) return;
      const reordered = [...members];
      const [item] = reordered.splice(idx, 1);
      reordered.unshift(item);
      // Single batch: rewrite sort_order
      const { addGroupMember } = await import("../../action/db");
      // Remove all, re-add in new order
      const { removeGroupMember } = await import("../../action/db");
      for (const m of members) await removeGroupMember(active.identifier, m.server_identifier);
      for (let i = 0; i < reordered.length; i++) {
        await addGroupMember(active.identifier, reordered[i].server_identifier, i);
      }
      setMembers(reordered);
      // Sync config without restart if engine is running
      await vpnServiceManager.syncConfig({});
      if (isRunning) onUpdate();
    } catch (e) { console.error(e); setSelectedId(selectedId); }
  };

  // Close dropdown on outside click
  useEffect(() => { if (!open) return; const h = () => setOpen(false); document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, [open]);

  const canPickNode = active?.group_type === "fixed";

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
              {active ? <>{active.name} <span className="text-[var(--aurorabox-label-tertiary)] text-xs">({GROUP_LABELS[active.group_type]})</span></>
                : <span className="text-[var(--aurorabox-label-tertiary)]">无组 — 去 Servers 创建</span>}
            </span>
            <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div className="absolute z-20 mt-1 w-full rounded-xl py-1 shadow-lg border border-[var(--aurorabox-separator)] max-h-48 overflow-y-auto"
              style={{ background: "var(--aurorabox-card)" }}>
              {(groups || []).map(g => (
                <button key={g.identifier} onClick={(e) => { e.stopPropagation(); handleSelectGroup(g); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--aurorabox-row-hover)]"
                  style={{ color: g.is_active ? "var(--aurorabox-blue)" : "var(--aurorabox-label)" }}>
                  <span className="flex-1 text-left truncate">{g.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--aurorabox-fill)" }}>{GROUP_LABELS[g.group_type]}</span>
                  {g.is_active && <span className="w-2 h-2 rounded-full bg-[var(--aurorabox-green)]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Node List — mode-dependent */}
      <section className="w-full">
        <SectionLabel>节点 {active && <span className="text-[10px] font-normal text-[var(--aurorabox-label-tertiary)]">— {GROUP_DESC[active.group_type]}</span>}</SectionLabel>

        {!active && <p className="text-xs text-[var(--aurorabox-label-tertiary)] px-1 py-2">请先选择或创建一个代理组</p>}

        {active && canPickNode && (
          <div className="space-y-0.5 max-h-60 overflow-y-auto">
            {members.map((m: any) => {
              const svr = servers.find(s => s.identifier === m.server_identifier);
              if (!svr) return null;
              const isSelected = m.server_identifier === selectedId;
              return (
                <button key={m.server_identifier} onClick={() => handleSelectNode(m.server_identifier)} disabled={switching}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-[var(--aurorabox-row-hover)] transition-colors disabled:opacity-50"
                  style={{ color: isSelected ? "var(--aurorabox-blue)" : "var(--aurorabox-label)" }}>
                  <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 transition-colors ${
                    isSelected ? "border-[var(--aurorabox-blue)] bg-[var(--aurorabox-blue)]" : "border-[var(--aurorabox-fill-strong)]"
                  }`} />
                  <span className="flex-1 text-left truncate">{svr.name}</span>
                  <span className="text-[10px] text-[var(--aurorabox-label-tertiary)]">{svr.server_address.split(".").slice(0, 2).join(".")}...:{svr.server_port}</span>
                </button>
              );
            })}
            {members.length === 0 && <p className="text-xs text-[var(--aurorabox-label-tertiary)] px-1 py-2">展开组添加服务器</p>}
          </div>
        )}

        {active && !canPickNode && (
          <div className="px-3 py-4 rounded-xl text-center" style={{ background: "var(--aurorabox-fill)" }}>
            <p className="text-xs text-[var(--aurorabox-label-tertiary)]">
              {active.group_type === "auto" && "节点自动切换 — sing-box URlTest 实时选最优"}
              {active.group_type === "random" && "节点随机切换 — 每次连接随机选一个"}
              {active.group_type === "chain" && `链路模式 — 流量按序经过 ${members.length} 个节点`}
            </p>
          </div>
        )}
      </section>

      <NetworkSpeed isRunning={isRunning} />
    </div>
  );
}
