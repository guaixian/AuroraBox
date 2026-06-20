import { useEffect, useState } from "react";
import { getStoreValue, setStoreValue } from "../single/store";
import { ENABLE_TUN_STORE_KEY } from "../types/definition";
import { toast } from "sonner";
import { useVersion } from "../hooks/useVersion";
import UpdaterItem from "../components/settings/updater";
import AboutItem from "../components/settings/about";
import RouterSettingsItem from "../components/settings/router-settings";
import ProxyPortSetting from "../components/settings/proxy-port";
import { t } from "../utils/helper";

function ToggleRow({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="setting-row">
      <div className="setting-label">{label}{desc && <div className="setting-desc">{desc}</div>}</div>
      <div className={`toggle ${value ? "on" : ""}`} onClick={() => onChange(!value)} />
    </div>
  );
}

export default function Settings() {
  const [tun, setTun] = useState(false);
  const [lan, setLan] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [lang, setLang] = useState("");
  const version = useVersion();

  useEffect(() => {
    getStoreValue(ENABLE_TUN_STORE_KEY, false).then(setTun);
    getStoreValue("allow_lan", false).then(setLan);
    getStoreValue("auto_start", false).then(setAutoStart);
    getStoreValue("language", "en").then(setLang);
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
          <ProxyPortSetting />
          <ToggleRow label={t("allow_lan_connection")} desc={t("allow_lan_connection")} value={lan} onChange={handleLan} />
          <ToggleRow label={t("tun_mode")} desc={t("tun_mode_desc")} value={tun} onChange={handleTun} />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t("general") || "General"}</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <div className="setting-row" onClick={handleLang} style={{cursor:"pointer"}}>
            <div className="setting-label">{t("language")}</div>
            <div className="setting-value">{lang === "zh" ? "中文" : "English"}</div>
            <div className="setting-arrow">›</div>
          </div>
          <ToggleRow label={t("auto_start")} desc={t("auto_start_failed_1")} value={autoStart} onChange={handleAutoStart} />
          <RouterSettingsItem />
          <UpdaterItem />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t("about") || "About"}</div>
        <div className="grouped-list" style={{borderRadius:"var(--r-lg)",overflow:"hidden"}}>
          <AboutItem />
        </div>
      </div>

      <div style={{marginTop:24,textAlign:"center",fontSize:11,color:"var(--text3)"}}>
        AuroraBox v{version || "1.0.0"}
      </div>
    </div>
  );
}
