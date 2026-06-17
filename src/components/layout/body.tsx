import React, { Suspense, useMemo } from "react";
import { ActiveScreenType } from "../../single/context";
import HomePage from "../../page/home";

const ConfigurationPage = React.lazy(() => import("../../page/config"));
const DevPage = React.lazy(() => import("../../page/developer"));
const SettingsPage = React.lazy(() => import("../../page/settings"));
const RouterSettingsPage = React.lazy(() => import("../../page/router"));
const ServersPage = React.lazy(() => import("../../page/servers"));

const LoadingFallback = () => (
  <div className="flex flex-col items-center justify-center h-full space-y-4">
    <span className="aurorabox-spinner aurorabox-spinner-ring aurorabox-spinner-lg" />
  </div>
);

interface BodyProps {
  lang: string;
  activeScreen: ActiveScreenType;
}

export function Body({ lang, activeScreen }: BodyProps) {
  const lazyComponent = useMemo(() => {
    switch (activeScreen) {
      case "home":
        return <HomePage />;
      case "configuration":
        return (
          <Suspense fallback={<LoadingFallback />}>
            <ConfigurationPage />
          </Suspense>
        );
      case "settings":
        return (
          <Suspense fallback={<LoadingFallback />}>
            <SettingsPage />
          </Suspense>
        );
      case "developer_options":
        return (
          <Suspense fallback={<LoadingFallback />}>
            <DevPage />
          </Suspense>
        );
      case "router_settings":
        return (
          <Suspense fallback={<LoadingFallback />}>
            <RouterSettingsPage />
          </Suspense>
        );
      case "servers":
        return (
          <Suspense fallback={<LoadingFallback />}>
            <ServersPage />
          </Suspense>
        );
      default:
        return null;
    }
  }, [activeScreen]);

  return (
    <div className="flex-1 overflow-y-hidden">
      {activeScreen && (
        <div
          className="animate-fade-in h-full overflow-y-auto"
          key={`${activeScreen}-${lang}`}
        >
          {lazyComponent}
        </div>
      )}
    </div>
  );
}
