import { useEffect, useState } from "react";
import { getStoreValue, setStoreValue, getProxyPort } from "../single/store";
import { ENABLE_TUN_STORE_KEY } from "../types/definition";
import { NavContext } from "../single/context";
import { useContext } from "react";
import { toast } from "sonner";
import { useVersion } from "../hooks/useVersion";
import { t } from "../utils/helper";

function ToggleRow({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="setting-row">
      <div className="setting-label">{label}{desc && <div className="setting-desc">{desc}</div>}</div>
      <div className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)} />
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
        <div className="settings-group-title">{t("network") || "Network"}</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <div className="setting-row">
            <div className="setting-label">{t("proxy_port")}<div className="setting-desc">{t("proxy_port_desc")}</div></div>
            <div className="setting-value">{port}</div>
            <div className="setting-arrow" style={{cursor:"pointer"}} onClick={() => {
              const p = prompt(t("proxy_port"), String(port));
              if (p && !isNaN(+p) && +p > 0 && +p < 65536) { setPort(+p); setStoreValue("proxy_port", +p); }
            }}>›</div>
          </div>
          <ToggleRow label={t("allow_lan_connection")} desc={t("cannot_open_lan_connection")} value={lan} onChange={handleLan} />
          <ToggleRow label={t("tun_mode")} desc={t("tun_mode_desc")} value={tun} onChange={handleTun} />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">General</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <div className="setting-row" onClick={handleLang} style={{cursor:"pointer"}}>
            <div className="setting-label">{t("language")}<div className="setting-desc">{t("language_description")}</div></div>
            <div className="setting-value">{lang === "zh" ? "中文" : "English"}</div>
            <div className="setting-arrow">›</div>
          </div>
          <ToggleRow label={t("auto_start")} desc={t("auto_start_failed_1")} value={autoStart} onChange={handleAutoStart} />
          <div className="setting-row" onClick={() => setActiveScreen("router_settings")} style={{cursor:"pointer"}}>
            <div className="setting-label">{t("router_settings")}<div className="setting-desc">{t("custom_router_rules")}</div></div>
            <div className="setting-arrow">›</div>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Developer</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <ToggleRow label={t("developer_toggle")} desc={t("developer_toggle_desc")} value={devMode} onChange={async (v) => { setDevMode(v); await setStoreValue("developer_toggle", v); }} />
        </div>
      </div>

      <div style={{marginTop:24,textAlign:"center",fontSize:11,color:"var(--text3)"}}>
        AuroraBox v{version || "1.0.0"}
      </div>
    </div>
  );
}
