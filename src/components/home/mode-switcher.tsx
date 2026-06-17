import clsx from "clsx";
import { RefObject } from "react";
import { Globe, Shield } from "react-bootstrap-icons";
import { t } from "../../utils/helper";
import type { ProxyMode } from "./hooks";

type ModeSwitcherProps = {
    selectedMode: ProxyMode;
    onModeChange: (mode: ProxyMode) => void;
    indicatorStyle: { left: number; width: number };
    containerRef: RefObject<HTMLDivElement | null>;
};

const MODES: { key: ProxyMode; icon: typeof Shield }[] = [
    { key: "rules", icon: Shield },
    { key: "global", icon: Globe },
];

// iOS 26 glass segmented control.
// Track: translucent gray fill with backdrop-blur — picks up colour from
// whatever is underneath. Selected pill: white glass with its own specular
// highlight, nested inside the trough (concentric radii). Only motion is
// the pill sliding + text re-tinting.
export function ModeSwitcher(props: ModeSwitcherProps) {
    const { selectedMode, onModeChange, indicatorStyle, containerRef } = props;

    return (
        <div
            ref={containerRef}
            className="aurorabox-segmented relative inline-flex p-0.75 rounded-full"
        >
            <span
                aria-hidden
                className="aurorabox-segmented-pill absolute top-0.75 bottom-0.75 rounded-full"
                style={{
                    left: `${indicatorStyle.left}px`,
                    width: `${indicatorStyle.width}px`,
                }}
            />

            {MODES.map(({ key, icon: Icon }) => {
                const isActive = selectedMode === key;
                return (
                    <button
                        key={key}
                        type="button"
                        data-mode={key}
                        title={t(`${key}_tip`)}
                        onClick={() => onModeChange(key)}
                        className={clsx(
                            "relative z-[1] inline-flex items-center gap-1.5",
                            "px-3.5 py-1 rounded-full",
                            "text-[13px] leading-none tracking-[-0.005em]",
                            "transition-colors duration-200",
                            isActive ? "font-medium" : "",
                        )}
                        style={{
                            color: isActive
                                ? "var(--aurorabox-label)"
                                : "var(--aurorabox-label-secondary)",
                        }}
                    >
                        <Icon
                            size={11}
                            className="transition-colors duration-200"
                            style={{
                                color: isActive
                                    ? "var(--aurorabox-blue)"
                                    : "var(--aurorabox-label-tertiary)",
                            }}
                        />
                        <span className="capitalize">{t(key)}</span>
                    </button>
                );
            })}
        </div>
    );
}
