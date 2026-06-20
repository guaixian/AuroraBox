import { ActiveScreenType, NavContext } from "../../single/context";
import { DEVELOPER_TOGGLE_STORE_KEY } from "../../types/definition";
import { getStoreValue } from "../../single/store";
import { t } from "../../utils/helper";
import { useContext, useEffect, useState } from "react";

interface NavItem { screen: ActiveScreenType; icon: string; label: string; }

export function Sidebar() {
  const { activeScreen, setActiveScreen } = useContext(NavContext);
  const [isDev, setIsDev] = useState(false);

  useEffect(() => { getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false).then(setIsDev); }, []);

  const mainItems: NavItem[] = [
    { screen: "home", icon: "◎", label: t("home") },
    { screen: "servers", icon: "⊞", label: t("servers") },
  ];
  const proxyItems: NavItem[] = [
    { screen: "groups" as ActiveScreenType, icon: "◆", label: t("proxy_group") },
  ];

  const renderItem = (item: NavItem) => (
    <button key={item.screen} onClick={() => setActiveScreen(item.screen)}
      data-active={activeScreen === item.screen} className="aurorabox-sidebar-item">
      <span style={{fontSize:15,width:22,textAlign:"center",flexShrink:0}}>{item.icon}</span>
      <span className="aurorabox-sidebar-label">{item.label}</span>
    </button>
  );

  return (
    <aside className="aurorabox-sidebar">
      <div className="aurorabox-sidebar-top">
        <div className="sidebar-section-label">Main</div>
        {mainItems.map(renderItem)}
        <div className="sidebar-section-label" style={{marginTop:8}}>Proxy</div>
        {proxyItems.map(renderItem)}
      </div>
      <div className="sidebar-spacer" />
      <div className="aurorabox-sidebar-bottom">
        <div className="sidebar-section-label">System</div>
        <button data-active={activeScreen === "settings"} onClick={() => setActiveScreen("settings")}
          className="aurorabox-sidebar-item">
          <span style={{fontSize:15,width:22,textAlign:"center",flexShrink:0}}>⚙</span>
          <span className="aurorabox-sidebar-label">{t("settings")}</span>
        </button>
        {isDev && (
          <button data-active={activeScreen === "developer_options"} onClick={() => setActiveScreen("developer_options")}
            className="aurorabox-sidebar-item">
            <span style={{fontSize:15,width:22,textAlign:"center",flexShrink:0}}>🔧</span>
            <span className="aurorabox-sidebar-label">{t("developer_options")}</span>
          </button>
        )}
      </div>
    </aside>
  );
}
