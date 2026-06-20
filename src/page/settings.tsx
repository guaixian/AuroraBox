import { useEffect, useState } from "react";
import { getStoreValue, setStoreValue } from "../single/store";
import { getProxyPort } from "../single/store";
import { ENABLE_TUN_STORE_KEY } from "../types/definition";
import { toast } from "sonner";

function ToggleRow({ icon, iconBg, label, desc, value, onChange }: { icon: string; iconBg: string; label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="setting-row">
      <div className="setting-icon" style={{background:iconBg}}>{icon}</div>
      <div className="setting-label">{label}{desc && <div className="setting-desc">{desc}</div>}</div>
      <div className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)} />
    </div>
  );
}

function LinkRow({ icon, iconBg, label, desc, value, onClick }: { icon: string; iconBg: string; label: string; desc?: string; value?: string; onClick?: () => void }) {
  return (
    <div className="setting-row" onClick={onClick} style={onClick?{cursor:"pointer"}:{}}>
      <div className="setting-icon" style={{background:iconBg}}>{icon}</div>
      <div className="setting-label">{label}{desc && <div className="setting-desc">{desc}</div>}</div>
      {value && <div className="setting-value">{value}</div>}
      {onClick && <div className="setting-arrow">›</div>}
    </div>
  );
}

export default function Settings() {
  const [tun, setTun] = useState(false);
  const [lan, setLan] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [lang, setLang] = useState("");
  const [proxyPort, setProxyPort] = useState(0);

  useEffect(() => {
    getStoreValue(ENABLE_TUN_STORE_KEY, false).then(setTun);
    getStoreValue("allow_lan", false).then(setLan);
    getStoreValue("auto_start", false).then(setAutoStart);
    getStoreValue("language", "en").then(setLang);
    getProxyPort().then(setProxyPort);
  }, []);

  const handleTun = async (v: boolean) => { setTun(v); await setStoreValue(ENABLE_TUN_STORE_KEY, v); };
  const handleLan = async (v: boolean) => { setLan(v); await setStoreValue("allow_lan", v); };
  const handleAutoStart = async (v: boolean) => { setAutoStart(v); await setStoreValue("auto_start", v); };
  const handleLang = async () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next); await setStoreValue("language", next);
    toast.success(next === "zh" ? "已切换为中文" : "Switched to English");
  };

  return (
    <div className="page-body">
      <div className="settings-group">
        <div className="settings-group-title">Network</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <LinkRow icon="⇄" iconBg="rgba(255,154,3,0.12)" label="Proxy Port" desc="HTTP/SOCKS mixed inbound" value={String(proxyPort)} />
          <ToggleRow icon="⇅" iconBg="rgba(52,120,246,0.12)" label="Allow LAN" desc="Other devices can connect" value={lan} onChange={handleLan} />
          <ToggleRow icon="◆" iconBg="rgba(48,177,88,0.12)" label="TUN Mode" desc="Virtual NIC, system-wide proxy" value={tun} onChange={handleTun} />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">General</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <LinkRow icon="🌐" iconBg="rgba(168,85,247,0.1)" label="Language" value={lang === "zh" ? "中文" : "English"} onClick={handleLang} />
          <ToggleRow icon="⚡" iconBg="rgba(255,59,48,0.1)" label="Auto Start" desc="Launch on system login" value={autoStart} onChange={handleAutoStart} />
        </div>
      </div>

      <div style={{marginTop:24,textAlign:"center",fontSize:11,color:"var(--text3)"}}>
        AuroraBox v1.0.0
      </div>
    </div>
  );
}
