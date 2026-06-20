import { useEffect, useState } from "react";
import useSWR from "swr";
import { Plus } from "react-bootstrap-icons";
import { addGroupMember, deleteProxyGroup, getGroupMembers, getProxyGroups, getProxyServers, insertProxyGroup, removeGroupMember, setActiveProxyGroup } from "../action/db";
import { GET_PROXY_GROUPS_SWR_KEY, GET_PROXY_SERVERS_SWR_KEY } from "../types/definition";
import type { ProxyGroup, ProxyServer } from "../types/definition";
import { toast } from "sonner";

const TYPE_LABEL: Record<string, string> = { fixed: "Fixed", auto: "Auto", random: "Random", chain: "Chain" };

export default function GroupsPage() {
  const { data: groups, mutate: mutateGroups } = useSWR(GET_PROXY_GROUPS_SWR_KEY, getProxyGroups, { fallbackData: [] });
  const { data: servers } = useSWR(GET_PROXY_SERVERS_SWR_KEY, getProxyServers, { fallbackData: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("fixed");

  const selected = (groups || []).find(g => g.identifier === selectedId);

  useEffect(() => {
    if (selected) getGroupMembers(selected.identifier).then(setMembers);
    else setMembers([]);
  }, [selectedId, groups]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try { await insertProxyGroup(newName.trim(), newType); mutateGroups(); setShowCreate(false); setNewName(""); } catch (e: any) { toast.error(String(e)); }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try { await deleteProxyGroup(selected.identifier); setSelectedId(null); mutateGroups(); } catch (e: any) { toast.error(String(e)); }
  };

  const handleToggleActive = async (g: ProxyGroup) => {
    try { await setActiveProxyGroup(g.is_active ? null : g.identifier); mutateGroups(); } catch (e: any) { toast.error(String(e)); }
  };

  const handleAddMember = async (s: ProxyServer) => {
    if (!selected) return;
    try { await addGroupMember(selected.identifier, s.identifier, members.length); const m = await getGroupMembers(selected.identifier); setMembers(m); window.dispatchEvent(new CustomEvent("group-members-changed")); } catch (e: any) { toast.error(String(e)); }
  };

  const handleRemoveMember = async (serverId: string) => {
    if (!selected) return;
    try { await removeGroupMember(selected.identifier, serverId); const m = await getGroupMembers(selected.identifier); setMembers(m); window.dispatchEvent(new CustomEvent("group-members-changed")); } catch (e: any) { toast.error(String(e)); }
  };

  const handleReorder = async (serverId: string, dir: "up" | "down") => {
    const idx = members.findIndex((m: any) => m.server_identifier === serverId);
    if (idx === -1) return;
    const newIdx = dir === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= members.length) return;
    const reordered = [...members];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    try {
      for (let i = 0; i < reordered.length; i++) await addGroupMember(selected!.identifier, reordered[i].server_identifier, i);
      const m = await getGroupMembers(selected!.identifier); setMembers(m);
      window.dispatchEvent(new CustomEvent("group-members-changed"));
    } catch (e: any) { toast.error(String(e)); }
  };

  const getBadge = (s: ProxyServer) => {
    const t = s.proxy_type || "ss";
    const map: Record<string, string> = { hysteria2: "badge-hy2", vless: "badge-vl", trojan: "badge-tj", socks5: "badge-s5", http: "badge-ht", ss: "badge-ss" };
    return map[t] || "badge-ht";
  };
  const getTypeLabel = (t: string) => ({ hysteria2: "HY2", vless: "VL", trojan: "TJ", socks5: "S5", http: "HTTP", ss: "SS" })[t] || t.toUpperCase();

  const availableServers = (servers || []).filter(s => !members.some((m: any) => m.server_identifier === s.identifier));

  return (
    <div style={{padding: "20px 24px", height: "100%"}}>
      <div className="toolbar">
        <button className="btn primary" onClick={() => setShowCreate(true)}><Plus size={14} /> New Group</button>
        <div style={{flex:1}} />
      </div>

      {showCreate && (
        <div style={{display:"flex",gap:8,marginBottom:12,padding:10,background:"var(--bg-card)",borderRadius:"var(--radius)",border:"0.5px solid var(--border)",alignItems:"center"}}>
          <input className="btn" style={{width:160}} placeholder="Group name" value={newName} onChange={e => setNewName(e.target.value)} />
          <select value={newType} onChange={e => setNewType(e.target.value)} className="btn">
            <option value="fixed">Fixed</option><option value="auto">Auto</option><option value="random">Random</option><option value="chain">Chain</option>
          </select>
          <button className="btn primary sm" onClick={handleCreate}>Create</button>
          <button className="btn sm" onClick={() => setShowCreate(false)}>Cancel</button>
        </div>
      )}

      <div className="groups-layout">
        {/* Left: Group List */}
        <div className="groups-left">
          {(groups || []).map(g => (
            <div key={g.identifier} className={`group-item ${g.identifier === selectedId ? "active" : ""}`}
              onClick={() => setSelectedId(g.identifier)}>
              <div className="group-dot" style={g.is_active ? {background:"var(--green)"} : {}} />
              <span className="group-name">{g.name}</span>
              <span className="group-type-tag">{TYPE_LABEL[g.group_type] || g.group_type}</span>
              {g.is_active && <span style={{fontSize:9,color:"var(--green)",fontWeight:600}}>ACTIVE</span>}
            </div>
          ))}
          {(!groups || groups.length === 0) && <div className="empty-state">No groups yet</div>}
          {selected && (
            <div style={{marginTop:8}}>
              <button className="btn sm" onClick={() => handleToggleActive(selected)}>{selected.is_active ? "Deactivate" : "Set Active"}</button>
              <button className="btn sm danger" style={{marginLeft:8}} onClick={handleDelete}>Delete</button>
            </div>
          )}
        </div>

        {/* Right: Member Editor */}
        <div className="groups-right">
          {!selected && <div className="empty-state">Select a group to manage members</div>}
          {selected && (
            <>
              <div className="section-title">
                {selected.name} · {TYPE_LABEL[selected.group_type]}
                {selected.group_type === "auto" && " — URlTest picks lowest latency"}
                {selected.group_type === "chain" && " — Order = proxy cascade"}
                {selected.group_type === "fixed" && " — First member is default"}
              </div>
              {members.map((m: any, i: number) => {
                const svr = (servers || []).find(s => s.identifier === m.server_identifier);
                if (!svr) return null;
                return (
                  <div key={m.server_identifier} className="member-row">
                    {(selected.group_type === "fixed" || selected.group_type === "chain") && (
                      <div className="member-idx">{i + 1}</div>
                    )}
                    <span className={`badge ${getBadge(svr)}`}>{getTypeLabel(svr.proxy_type || "ss")}</span>
                    <span className="group-name">{svr.name}</span>
                    <span className="list-addr">{svr.server_address}:{svr.server_port}</span>
                    <div style={{flex:1}} />
                    {selected.group_type === "chain" && (
                      <div style={{display:"flex",gap:2}}>
                        <button className="btn xs" onClick={() => handleReorder(m.server_identifier, "up")} disabled={i === 0}>▲</button>
                        <button className="btn xs" onClick={() => handleReorder(m.server_identifier, "down")} disabled={i === members.length - 1}>▼</button>
                      </div>
                    )}
                    <button className="btn xs danger" onClick={() => handleRemoveMember(m.server_identifier)}>✕</button>
                  </div>
                );
              })}
              {members.length === 0 && <div className="empty-state">No members — add servers from below</div>}
              <div style={{marginTop:12, borderTop:"0.5px solid var(--border)", paddingTop:10}}>
                <div className="section-title">Available Servers</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                  {availableServers.map(s => (
                    <button key={s.identifier} className="btn xs" onClick={() => handleAddMember(s)}>+ {s.name}</button>
                  ))}
                  {availableServers.length === 0 && <span className="text-muted" style={{fontSize:11,padding:4}}>All servers in group</span>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
