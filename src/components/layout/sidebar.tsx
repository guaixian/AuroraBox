import { GearWideConnected, House, Layers, Server, Wrench } from "react-bootstrap-icons";
import { ActiveScreenType, NavContext } from "../../single/context";
import { DEVELOPER_TOGGLE_STORE_KEY } from "../../types/definition";
import { getStoreValue } from "../../single/store";
import { t } from "../../utils/helper";
import { useContext, useEffect, useState } from "react";

interface NavItem { screen: ActiveScreenType; icon: React.ReactNode; label: string; }

export function Sidebar() {
  const { activeScreen, setActiveScreen } = useContext(NavContext);
  const [isDev, setIsDev] = useState(false);

  useEffect(() => { getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false).then(setIsDev); }, []);

  const mainItems: NavItem[] = [
    { screen: "home", icon: <House size={18} />, label: t("home") },
    { screen: "servers", icon: <Server size={18} />, label: t("servers") },
  ];
  const proxyItems: NavItem[] = [
    { screen: "groups" as ActiveScreenType, icon: <Layers size={18} />, label: t("proxy_group") },
  ];
  const bottomItems: NavItem[] = [
    { screen: "settings", icon: <GearWideConnected size={18} />, label: t("settings") },
    ...(isDev ? [{ screen: "developer_options" as ActiveScreenType, icon: <Wrench size={18} />, label: t("developer_options") }] : []),
  ];

  const renderItem = (item: NavItem) => (
    <button key={item.screen} onClick={() => setActiveScreen(item.screen)}
      data-active={activeScreen === item.screen} className="aurorabox-sidebar-item">
      {item.icon}
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
      <div className="aurorabox-sidebar-bottom">{bottomItems.map(renderItem)}</div>
    </aside>
  );
}
