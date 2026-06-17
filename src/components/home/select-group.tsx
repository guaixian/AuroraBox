import { useEffect, useState } from "react";
import useSWR from "swr";
import { ChevronDown } from "react-bootstrap-icons";
import { getProxyGroups, setActiveProxyGroup } from "../../action/db";
import { GET_PROXY_GROUPS_SWR_KEY } from "../../types/definition";
import type { ProxyGroup } from "../../types/definition";
import { t } from "../../utils/helper";

interface Props {
  onUpdate: () => void;
}

export default function SelectGroup({ onUpdate }: Props) {
  const { data: groups } = useSWR(GET_PROXY_GROUPS_SWR_KEY, getProxyGroups, { fallbackData: [] });
  const [open, setOpen] = useState(false);
  const active = (groups || []).find(g => g.is_active);

  const handleSelect = async (g: ProxyGroup) => {
    setOpen(false);
    if (g.is_active) return;
    try {
      await setActiveProxyGroup(g.identifier);
      onUpdate();
    } catch (e) { console.error(e); }
  };

  const GROUP_LABELS: Record<string, string> = {
    fixed: "固定", auto: "自动", random: "随机", chain: "链路"
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors"
        style={{
          background: "var(--aurorabox-fill)",
          color: "var(--aurorabox-label)",
        }}
      >
        <span className="flex-1 text-left truncate">
          {active ? (
            <>{active.name} <span className="text-[var(--aurorabox-label-tertiary)] text-xs">({GROUP_LABELS[active.group_type] || active.group_type})</span></>
          ) : (
            <span className="text-[var(--aurorabox-label-tertiary)]">{t("no_group") || "无组"}</span>
          )}
        </span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute z-20 mt-1 w-full rounded-xl py-1 shadow-lg border border-[var(--aurorabox-separator)] max-h-48 overflow-y-auto"
          style={{ background: "var(--aurorabox-card)" }}
        >
          {(groups || []).map(g => (
            <button
              key={g.identifier}
              onClick={(e) => { e.stopPropagation(); handleSelect(g); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[var(--aurorabox-row-hover)] transition-colors"
              style={{ color: g.is_active ? "var(--aurorabox-blue)" : "var(--aurorabox-label)" }}
            >
              <span className="flex-1 text-left truncate">{g.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--aurorabox-fill)", color: "var(--aurorabox-label-secondary)" }}>
                {GROUP_LABELS[g.group_type] || g.group_type}
              </span>
              {g.is_active && <span className="w-2 h-2 rounded-full bg-[var(--aurorabox-green)]" />}
            </button>
          ))}
          {(!groups || groups.length === 0) && (
            <p className="px-3 py-2 text-xs text-[var(--aurorabox-label-tertiary)]">暂无代理组，去 Servers 页面创建</p>
          )}
        </div>
      )}
    </div>
  );
}
