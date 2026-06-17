import {
  GearWideConnected,
  House,
  Layers,
  Server,
  Wrench,
} from "react-bootstrap-icons";
import { ActiveScreenType, NavContext } from "../../single/context";
import { DEVELOPER_TOGGLE_STORE_KEY } from "../../types/definition";
import { getStoreValue } from "../../single/store";
import { t } from "../../utils/helper";
import { useContext, useEffect, useState } from "react";

interface NavItem {
  screen: ActiveScreenType;
  icon: React.ReactNode;
  label: string;
}

export function Sidebar() {
  const { activeScreen, setActiveScreen } = useContext(NavContext);
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    getStoreValue(DEVELOPER_TOGGLE_STORE_KEY, false).then(setIsDev);
  }, []);

  const topItems: NavItem[] = [
    { screen: "home", icon: <House size={20} />, label: t("home") },
    {
      screen: "configuration",
      icon: <Layers size={20} />,
      label: t("configuration"),
    },
    { screen: "servers", icon: <Server size={20} />, label: t("servers") },
  ];

  const bottomItems: NavItem[] = [
    { screen: "settings", icon: <GearWideConnected size={20} />, label: t("settings") },
    ...(isDev
      ? [
          {
            screen: "developer_options" as ActiveScreenType,
            icon: <Wrench size={20} />,
            label: t("developer_options"),
          },
        ]
      : []),
  ];

  const renderItem = (item: NavItem) => (
    <button
      key={item.screen}
      onClick={() => setActiveScreen(item.screen)}
      data-active={activeScreen === item.screen}
      className="aurorabox-sidebar-item"
    >
      {item.icon}
      <span className="aurorabox-sidebar-label">{item.label}</span>
    </button>
  );

  return (
    <aside className="aurorabox-sidebar">
      <div className="aurorabox-sidebar-top">{topItems.map(renderItem)}</div>
      <div className="aurorabox-sidebar-bottom">{bottomItems.map(renderItem)}</div>
    </aside>
  );
}
