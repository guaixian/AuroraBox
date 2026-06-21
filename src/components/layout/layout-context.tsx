import React, { createContext, useContext, useEffect, useState } from "react";

export type LayoutMode = "compact" | "regular";

interface LayoutContextType {
  /** True when window width < 640px — use compact (iOS-style) layout */
  isCompact: boolean;
  /** The resolved layout mode */
  layout: LayoutMode;
}

const LayoutContext = createContext<LayoutContextType>({
  isCompact: false,
  layout: "regular",
});

export function useLayout() {
  return useContext(LayoutContext);
}

const COMPACT_BREAKPOINT = 640;

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  // Start with false (desktop) — on first render the Tauri window may not
  // have reached its target size yet. We measure immediately after mount
  // and switch to compact only if the window is genuinely narrow.
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const check = () => {
      setIsCompact(window.innerWidth < COMPACT_BREAKPOINT);
    };

    // Check as soon as the frame paints, then again after layout stabilises
    const raf = requestAnimationFrame(check);
    const timer = setTimeout(check, 200);

    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("resize", check);
      cancelAnimationFrame(raf);
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
