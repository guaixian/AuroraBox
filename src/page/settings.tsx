import { useEffect, useState } from "react";
import { getStoreValue, setStoreValue, getProxyPort } from "../single/store";
import { ENABLE_TUN_STORE_KEY } from "../types/definition";
import { NavContext } from "../single/context";
import { useContext } from "react";
import { toast } from "sonner";
import { useVersion } from "../hooks/useVersion";
import { t } from "../utils/helper";

function Row({ icon, iconBg, label, desc, right }: { icon: string; iconBg: string; label: string; desc?: string; right: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-icon" style={{background:iconBg}}>{icon}</div>
      <div className="setting-label">{label}{desc && <div className="setting-desc">{desc}</div>}</div>
      {right}
    </div>
  );
}

export default function SettingsPage() {
  const [tun, setTun] = useState(false);
  const [lan, setLan] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [lang, setLang] = useState("");
  const [port, setPort] = useState(0);
  const [devMode, setDevMode] = useState(false);
  const version = useVersion();
  const { setActiveScreen } = useContext(NavContext);

  useEffect(() => {
    getStoreValue(ENABLE_TUN_STORE_KEY, false).then(setTun);
    getStoreValue("allow_lan", false).then(setLan);
    getStoreValue("auto_start", false).then(setAutoStart);
    getStoreValue("language", "en").then(setLang);
    getProxyPort().then(setPort);
    getStoreValue("developer_toggle", false).then(setDevMode);
  }, []);

  const tog = (set: any, key: string) => async (v: boolean) => { set(v); await setStoreValue(key, v); };

  return (
    <div className="page-body">
      <div className="settings-group">
        <div className="settings-group-title">Network</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <Row icon="⇄" iconBg="rgba(255,154,3,0.12)" label="Proxy Port" desc="HTTP/SOCKS mixed inbound"
            right={<><div className="setting-value">{port}</div><div className="setting-arrow" style={{cursor:"pointer"}} onClick={()=>{const p=prompt("Port",String(port));if(p&&!isNaN(+p)&&+p>0&&+p<65536){setPort(+p);setStoreValue("proxy_port",+p)}}}>›</div></>} />
          <Row icon="⇅" iconBg="rgba(52,120,246,0.12)" label="Allow LAN" desc="Other devices can connect"
            right={<div className={`toggle ${lan?"on":""}`} onClick={()=>tog(setLan,"allow_lan")(!lan)} />} />
          <Row icon="◆" iconBg="rgba(48,177,88,0.12)" label="TUN Mode" desc="Virtual NIC, system-wide proxy"
            right={<div className={`toggle ${tun?"on":""}`} onClick={()=>tog(setTun,ENABLE_TUN_STORE_KEY)(!tun)} />} />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">General</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <Row icon="🌐" iconBg="rgba(168,85,247,0.1)" label="Language"
            right={<><div className="setting-value">{lang==="zh"?"中文":"English"}</div><div className="setting-arrow" style={{cursor:"pointer"}} onClick={async()=>{const n=lang==="zh"?"en":"zh";setLang(n);await setStoreValue("language",n);toast.success(n==="zh"?"已切换为中文":"Switched to English")}}>›</div></>} />
          <Row icon="⚡" iconBg="rgba(255,59,48,0.1)" label="Auto Start" desc="Launch on system login"
            right={<div className={`toggle ${autoStart?"on":""}`} onClick={()=>tog(setAutoStart,"auto_start")(!autoStart)} />} />
          <Row icon="☰" iconBg="rgba(52,120,246,0.12)" label={t("router_settings")} desc={t("custom_router_rules")}
            right={<div className="setting-arrow" style={{cursor:"pointer"}} onClick={()=>setActiveScreen("router_settings")}>›</div>} />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Developer</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <Row icon="🔧" iconBg="rgba(142,142,147,0.15)" label="Developer Mode" desc="Enable advanced options"
            right={<div className={`toggle ${devMode?"on":""}`} onClick={()=>tog(setDevMode,"developer_toggle")(!devMode)} />} />
        </div>
      </div>

      <div style={{marginTop:24,textAlign:"center",fontSize:11,color:"var(--text3)"}}>
        AuroraBox v{version || "1.0.0"}
      </div>
    </div>
  );
}
