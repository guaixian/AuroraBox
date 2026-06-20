import { useEffect, useState } from "react";
import useSWR from "swr";
import { Speedometer2, Stopwatch, Trash3 } from "react-bootstrap-icons";
import { deleteProxyServer, getProxyServers } from "../action/db";
import { GET_PROXY_SERVERS_SWR_KEY } from "../types/definition";
import type { ProxyServer } from "../types/definition";
import { buildOutboundJSON } from "../utils/build-outbound";
import { AddServerModal } from "../components/servers/add-server-modal";
import { ImportShareLinksModal } from "../components/servers/import-share-links-modal";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseProxyLink } from "../utils/shadowsocks-parser";

type LatMap = Record<string, { ms: number | null; tcpMs?: number; error?: string }>;
type SpdMap = Record<string, { kbps: number | null; error?: string }>;

function getBadge(t: string) { return ({hysteria2:"badge-hy2",vless:"badge-vl",trojan:"badge-tj",socks5:"badge-s5",http:"badge-ht",ss:"badge-ss"})[t]||"badge-ht"; }
function getLabel(t: string) { return ({hysteria2:"HY2",vless:"VL",trojan:"TJ",socks5:"S5",http:"HTTP",ss:"SS"})[t]||t.toUpperCase(); }

export default function ServersPage() {
  const { data: servers, mutate: refresh } = useSWR(GET_PROXY_SERVERS_SWR_KEY, getProxyServers, { fallbackData: [] });
  const [latency, setLatency] = useState<LatMap>({});
  const [speed, setSpeed] = useState<SpdMap>({});
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editServer, setEditServer] = useState<ProxyServer | null>(null);

  useEffect(() => {
    const unlisten = listen<{server:string;port:number;tcp_ms:number|null;real_ms:number|null;speed_kbps:number|null;error:string|null}>("proxy-test-result", (e) => {
      const r = e.payload; const key = `${r.server}:${r.port}`;
      setLatency(p=>({...p,[key]:{ms:r.real_ms,tcpMs:r.tcp_ms??undefined,error:r.error??undefined}}));
      setSpeed(p=>({...p,[key]:{kbps:r.speed_kbps?Math.round(r.speed_kbps):null,error:!r.speed_kbps?(r.error??undefined):undefined}}));
      setTesting(p=>{const n=new Set(p);n.delete(key);return n;});
    });
    return ()=>{unlisten.then(f=>f());};
  }, []);

  // Paste import
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      const text = e.clipboardData?.getData("text")?.trim(); if (!text) return;
      const links = text.split("\n").map(l => l.trim()).filter(Boolean);
      const parsed = links.map(l => parseProxyLink(l)).filter(Boolean);
      if (!parsed.length) return;
      e.preventDefault();
      try {
        const { batchInsertProxyServers } = await import("../action/db");
        await batchInsertProxyServers(parsed.map(s => ({
          name:s!.name,server_address:s!.server,server_port:s!.port,password:s!.password,
          encryption_method:s!.method,plugin:s!.plugin,plugin_opts:s!.pluginOpts,
          proxy_type:s!.proxyType||"ss",username:s!.username||"",
          vless_uuid:(s as any).vlessUUID||"",vless_opts:s!.vlessOpts?JSON.stringify(s!.vlessOpts):"",
        }))); refresh(); toast.success("Imported");
      } catch (err: any) { toast.error(String(err)); }
    };
    document.addEventListener("paste", handler);
    return () => document.removeEventListener("paste", handler);
  }, []);

  const handleDelete = async (id: string) => { try { await deleteProxyServer(id); refresh(); } catch (e: any) { toast.error(String(e)); } };

  const testOne = async (s: ProxyServer) => {
    const key = `${s.server_address}:${s.server_port}`;
    setTesting(p=>new Set([...p,key]));
    try { await invoke("run_singbox_tests", { outbounds: [JSON.stringify(buildOutboundJSON(s))] }); } catch(e){}
    setTesting(p=>{const n=new Set(p);n.delete(key);return n;});
  };

  const testAll = async () => {
    if (!servers?.length) return;
    const keys = servers.map(s=>`${s.server_address}:${s.server_port}`);
    setTesting(p=>{const n=new Set(p);keys.forEach(k=>n.add(k));return n;});
    try { await invoke("run_singbox_tests", { outbounds: servers.map(s=>JSON.stringify(buildOutboundJSON(s))) }); } catch(e){}
  };

  const handleExport = async () => {
    const links = (servers||[]).map(s => {
      const h = `${s.server_address}:${s.server_port}`;
      const p = s.proxy_type||"ss";
      if (p==="ss") return `ss://${btoa(`${s.encryption_method}:${s.password}`)}@${h}#${encodeURIComponent(s.name)}`;
      if (p==="trojan") return `trojan://${encodeURIComponent(s.password)}@${h}?security=tls#${encodeURIComponent(s.name)}`;
      if (p==="vless") return `vless://${(s as any).vless_uuid||""}@${h}?security=tls#${encodeURIComponent(s.name)}`;
      if (p==="hysteria2") return `hysteria2://${s.password}@${h}?sni=${s.server_address}&insecure=1#${encodeURIComponent(s.name)}`;
      if (p==="socks5") return `socks5://${s.username?s.username+":"+s.password:""}@${h}#${encodeURIComponent(s.name)}`;
      if (p==="http") return `http://${s.username?s.username+":"+s.password:""}@${h}#${encodeURIComponent(s.name)}`;
      return "";
    }).filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(links); toast.success("Exported"); } catch { toast.error("Failed"); }
  };

  return (
    <div className="page-body" style={{height:"100%"}}>
      <div className="toolbar">
        <button className="btn prim" onClick={() => { setEditServer(null); setShowAdd(true); }}>+ Add</button>
        <button className="btn" onClick={() => setShowImport(true)}>Import</button>
        <button className="btn" onClick={handleExport}>Export</button>
        <div style={{flex:1}}/>
        <button className="btn sm" onClick={testAll}><Stopwatch size={12}/> Latency</button>
        <button className="btn sm" onClick={testAll}><Speedometer2 size={12}/> Speed</button>
      </div>

      <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
        <table className="data-table">
          <thead><tr><th style={{width:24}}/><th>Name</th><th style={{width:60}}>Type</th><th>Server</th><th style={{width:65}}>Latency</th><th style={{width:75}}>Speed</th><th style={{width:80}}/></tr></thead>
          <tbody>
            {(servers||[]).map(s=>{
              const k=`${s.server_address}:${s.server_port}`;
              const l=latency[k]; const sp=speed[k]; const tg=testing.has(k);
              return (
                <tr key={s.identifier} style={{cursor:"pointer"}}>
                  <td><div className="list-radio" style={{display:"inline-block"}}/></td>
                  <td style={{fontWeight:500}}>{s.name}</td>
                  <td><span className={`badge ${getBadge(s.proxy_type||"ss")}`}>{getLabel(s.proxy_type||"ss")}</span></td>
                  <td style={{fontFamily:"monospace",fontSize:12,color:"var(--text2)"}}>{s.server_address}:{s.server_port}</td>
                  <td style={{fontFamily:"monospace",fontSize:12,color:l?.ms?l.ms<200?"var(--green)":l.ms<500?"var(--orange)":"var(--red)":"var(--text3)"}}>{tg?"...":l?.ms?l.ms+"ms":"—"}</td>
                  <td style={{fontFamily:"monospace",fontSize:12}}>{tg?"...":sp?.kbps?sp.kbps>=1024?(sp.kbps/1024).toFixed(1)+" MB/s":sp.kbps+" KB/s":"—"}</td>
                  <td>
                    <button className="btn xs" style={{marginRight:2}} onClick={(e)=>{e.stopPropagation();testOne(s)}} disabled={tg}><Stopwatch size={10}/></button>
                    <button className="btn xs" style={{marginRight:2}} onClick={(e)=>{e.stopPropagation();testOne(s)}} disabled={tg}><Speedometer2 size={10}/></button>
                    <button className="btn xs dang" onClick={(e)=>{e.stopPropagation();if(confirm("Delete?"))handleDelete(s.identifier)}}><Trash3 size={10}/></button>
                  </td>
                </tr>
              );
            })}
            {(!servers||servers.length===0)&&<tr><td colSpan={7} className="empty-state">No servers</td></tr>}
          </tbody>
        </table>
      </div>
      <AddServerModal visible={showAdd} editServer={editServer} onClose={() => setShowAdd(false)} onSaved={refresh} />
      <ImportShareLinksModal visible={showImport} onClose={() => setShowImport(false)} onImported={refresh} />
    </div>
  );
}
