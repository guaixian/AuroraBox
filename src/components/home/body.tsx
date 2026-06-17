import { t, vpnServiceManager } from "../../utils/helper";
import { AppleNetworkStatus, GoogleNetworkStatus } from "./network-check";
import NetworkSpeed from "./network-speed";
import SelectGroup from "./select-group";
import SelectNode from "./select-node";

function SectionLabel({
    children,
    trailing,
}: {
    children: React.ReactNode;
    trailing?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between px-1 mb-1.5">
            <span
                className="text-[11px] font-semibold uppercase tracking-[0.08em] capitalize"
                style={{ color: 'var(--aurorabox-label-secondary)' }}
            >
                {children}
            </span>
            {trailing && (
                <div className="flex items-center gap-2">{trailing}</div>
            )}
        </div>
    );
}

export default function Body({
    isRunning,
    onUpdate,
}: {
    isRunning: boolean;
    onUpdate: () => void;
}) {
    const handleUpdate = async () => {
        try {
            await vpnServiceManager.syncConfig({});
            onUpdate();
        } catch (error) {
            console.error(t("update_config_failed") + ":", error);
        }
    };

    return (
        <div className="w-full space-y-4">
            <section className="w-full">
                <SectionLabel
                    trailing={
                        <>
                            <AppleNetworkStatus />
                            <GoogleNetworkStatus isRunning={isRunning} />
                        </>
                    }
                >
                    {t("proxy_group") || "代理组"}
                </SectionLabel>
                <SelectGroup onUpdate={handleUpdate} />
            </section>

            <section className="w-full">
                <SectionLabel>{t("node_selection")}</SectionLabel>
                <SelectNode isRunning={isRunning} />
            </section>

            <NetworkSpeed isRunning={isRunning} />
        </div>
    );
}
