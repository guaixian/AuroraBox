import { ActiveScreenType } from "../../single/context";
import { Sidebar } from "./sidebar";
import { Body } from "./body";

interface DesktopShellProps {
  activeScreen: ActiveScreenType;
  language: string;
}

export function DesktopShell({ activeScreen, language }: DesktopShellProps) {
  return (
    <div className="aurorabox-desktop-shell">
      <Sidebar />
      <div className="aurorabox-desktop-content">
        <Body activeScreen={activeScreen} lang={language} />
      </div>
    </div>
  );
}
