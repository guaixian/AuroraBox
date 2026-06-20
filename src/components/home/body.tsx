import { useEffect, useState } from "react";
import useSWR from "swr";
import { ChevronDown, ClipboardData } from "react-bootstrap-icons";
import { getProxyGroups, getGroupMembers, setActiveProxyGroup, getProxyServers, setActiveProxyServer } from "../../action/db";
import { GET_PROXY_GROUPS_SWR_KEY } from "../../types/definition";
import type { ProxyGroup } from "../../types/definition";
import { vpnServiceManager } from "../../utils/helper";
import { AppleNetworkStatus, GoogleNetworkStatus } from "./network-check";
import NetworkSpeed from "./network-speed";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const GROUP_LABELS: Record<string, string> = { fixed: "Fixed", auto: "Auto", random: "Random", chain: "Chain" };

export default function Body({ isRunning, onUpdate }: { isRunning: boolean; onUpdate: () => void }) {
  const { data: groups } = useSWR(GET_PROXY_GROUPS_SWR_KEY, getProxyGroups, { fallbackData: [] });
  const [open, setOpen] = useState(false);
  const [allServers, setAllServers] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const active = (groups || []).find(g => g.is_active);
  const allNodesMode = !active;

  useEffect(() => {
    getProxyServers().then(s => {
      setAllServers(s);
      if (allNodesMode) setSelectedId(s.find((x: any) => x.is_active)?.identifier || null);
    });
  }, [groups]);

  useEffect(() => {
    if (!active) { setMembers([]); return; }
    getGroupMembers(active.identifier).then(m => {
      setMembers(m);
      if (m.length > 0) setSelectedId(m[0].server_identifier);
    });
  }, [active?.identifier]);

  const handleSelectGroup = async (g: ProxyGroup) => {
    setOpen(false);
    if (g.is_active && !allNodesMode) return;
    setSwitching(true);
    try { await setActiveProxyGroup(g.identifier); await vpnServiceManager.syncConfig({}); onUpdate(); } catch (e) { console.error(e); } finally { setSwitching(false); }
  };
  const handleSelectAllNodes = async () => {
    setOpen(false); if (allNodesMode) return;
    setSwitching(true);
    try { if (active) await setActiveProxyGroup(null); setMembers([]); const s = await getProxyServers(); setAllServers(s); setSelectedId(s.find((x: any) => x.is_active)?.identifier || null); } catch (e) { console.error(e); } finally { setSwitching(false); }
  };
  const handleSelectNode = async (serverId: string) => {
    if (switching || serverId === selectedId) return;
    const prev = selectedId; setSelectedId(serverId);
    try {
      if (allNodesMode) await setActiveProxyServer(serverId);
      else if (active && active.group_type === "fixed") {
        const idx = members.findIndex(m => m.server_identifier === serverId);
        if (idx <= 0) return;
        const reordered = [...members]; [reordered[0], reordered[idx]] = [reordered[idx], reordered[0]];
        const { removeGroupMember, addGroupMember } = await import("../../action/db");
        for (const m of members) await removeGroupMember(active.identifier, m.server_identifier);
        for (let i = 0; i < reordered.length; i++) await addGroupMember(active.identifier, reordered[i].server_identifier, i);
        setMembers(reordered);
      }
      await vpnServiceManager.syncConfig({}); if (isRunning) onUpdate();
    } catch (e) { console.error(e); setSelectedId(prev); }
  };
  useEffect(() => { if (!open) return; const h = () => setOpen(false); document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, [open]);

  const canPick = allNodesMode || active?.group_type === "fixed";
  const displayedNodes = allNodesMode ? allServers : members.map(m => allServers.find(s => s.identifier === m.server_identifier)).filter(Boolean);
  const getBadge = (t: string) => ({ hysteria2: "badge-hy2", vless: "badge-vl", trojan: "badge-tj", socks5: "badge-s5", http: "badge-ht", ss: "badge-ss" })[t] || "badge-ht";
  const getTypeLabel = (t: string) => ({ hysteria2: "HY2", vless: "VL", trojan: "TJ", socks5: "S5", http: "HTTP", ss: "SS" })[t] || t.toUpperCase();

  return (
    <div>
      {/* Power + Mode */}
      <div className="power-section">
        <div className={`power-btn ${isRunning ? "on" : ""}`} onClick={async () => {
          if (isRunning) await vpnServiceManager.stop();
          else { await vpnServiceManager.syncConfig({}); await vpnServiceManager.start(); }
          onUpdate();
        }}>⏻</div>
        <div className="power-label">{isRunning ? "Connected" : "Disconnected"}</div>
        <div className="power-sub">{selectedId ? allServers.find(s => s.identifier === selectedId)?.server_address + " · " + getTypeLabel(allServers.find(s => s.identifier === selectedId)?.proxy_type || "ss") : "—"}</div>

        <div className="mode-bar">
          <button className="mode-btn active">Rules</button>
          <button className="mode-btn">Global</button>
          <button className="mode-btn tun">TUN</button>
        </div>

        <div className="compact-stats">
          <div className="compact-stat"><div className="compact-stat-val" style={{color:"var(--green)"}}>—</div><div className="compact-stat-label">Ping</div></div>
          <div className="compact-stat"><div className="compact-stat-val">—</div><div className="compact-stat-label">Down</div></div>
          <div className="compact-stat"><div className="compact-stat-val">—</div><div className="compact-stat-label">Up</div></div>
        </div>
      </div>

      {/* Group Selector */}
      <div style={{marginTop:14}}>
        <div className="section-title">
          Active Group
          <div style={{position:"relative"}}>
            <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }} disabled={switching}
              className="btn sm" style={{marginLeft:4,fontSize:11}}>
              {allNodesMode ? "All Nodes" : active?.name || "—"} <ChevronDown size={10} />
            </button>
            {open && (
              <div style={{position:"absolute",top:"100%",left:0,zIndex:20,minWidth:180,marginTop:4,background:"var(--bg-card)",border:"0.5px solid var(--border)",borderRadius:"var(--radius)",padding:4}}>
                <button onClick={(e) => { e.stopPropagation(); handleSelectAllNodes(); }} className="aurorabox-sidebar-item" style={{width:"100%",color:allNodesMode?"var(--blue)":"var(--text)"}}>All Nodes</button>
                {(groups || []).map(g => (
                  <button key={g.identifier} onClick={(e) => { e.stopPropagation(); handleSelectGroup(g); }} className="aurorabox-sidebar-item" style={{width:"100%",color:(g.is_active && !allNodesMode)?"var(--blue)":"var(--text)"}}>
                    {g.name} <span className="group-type-tag" style={{marginLeft:"auto",fontSize:9}}>{GROUP_LABELS[g.group_type]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span style={{fontWeight:400,textTransform:"none",fontSize:10,color:"var(--text-secondary)",marginLeft:"auto"}}>
            {allNodesMode ? "Free selection" : active ? `${GROUP_LABELS[active.group_type]}` : ""}
          </span>
          <button onClick={async () => { await invoke('create_window', { app: getCurrentWindow(), title: "Log", label: "sing-box-log", windowTag: "sing-box-log" }); }}
            className="btn xs" style={{marginLeft:8}}><ClipboardData size={11}/> Log</button>
          <AppleNetworkStatus /><GoogleNetworkStatus isRunning={isRunning} />
        </div>

        {canPick && (
          <div className="grouped-list">
            {displayedNodes.map((svr: any) => (
              <div key={svr.identifier} className={`list-row ${svr.identifier === selectedId ? "selected" : ""}`}
                onClick={() => handleSelectNode(svr.identifier)}>
                <div className="list-radio" />
                <span className={`badge ${getBadge(svr.proxy_type || "ss")}`}>{getTypeLabel(svr.proxy_type || "ss")}</span>
                <span className="list-name">{svr.name}</span>
                <span className="list-addr">{svr.server_address.split(".").slice(0,2).join(".")}...:{svr.server_port}</span>
              </div>
            ))}
            {displayedNodes.length === 0 && <div className="empty-state">{allNodesMode ? "No servers" : "No members"}</div>}
          </div>
        )}
        {!canPick && active && (
          <div style={{padding:"12px 16px",borderRadius:"var(--radius)",background:"var(--bg-card)",border:"0.5px solid var(--border)",textAlign:"center",fontSize:11,color:"var(--text-secondary)"}}>
            {active.group_type === "auto" && "Auto switching — URlTest picks best node"}
            {active.group_type === "random" && "Random switching — picks on each connection"}
            {active.group_type === "chain" && `Cascade mode — ${members.length} hops`}
          </div>
        )}
      </div>

      <NetworkSpeed isRunning={isRunning} />
    </div>
  );
}
