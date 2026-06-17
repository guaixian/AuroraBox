import React, { createContext, useContext, useEffect, useState } from "react";

export type LayoutMode = "compact" | "regular";

interface LayoutContextType {
  /** True when window width < 640px — use compact (iOS-style) layout */
  isCompact: boolean;
  /** The resolved layout mode */
  layout: LayoutMode;
}

const LayoutContext = createContext<LayoutContextType>({
  isCompact: true,
  layout: "compact",
});

export function useLayout() {
  return useContext(LayoutContext);
}

const COMPACT_BREAKPOINT = 640;

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  const [isCompact, setIsCompact] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth < COMPACT_BREAKPOINT;
    }
    return true;
  });

  useEffect(() => {
    const check = () => {
      setIsCompact(window.innerWidth < COMPACT_BREAKPOINT);
    };

    window.addEventListener("resize", check);
    // The Tauri window may transition between sizes without a resize event
    // during initial layout; check once more after a short delay.
    const timer = setTimeout(check, 100);

    return () => {
      window.removeEventListener("resize", check);
      clearTimeout(timer);
    };
  }, []);

  return (
    <LayoutContext.Provider
      value={{ isCompact, layout: isCompact ? "compact" : "regular" }}
    >
      {children}
    </LayoutContext.Provider>
  );
}
