import { useEffect } from "react";
import Body from "../components/home/body";
import { useProxyMode, useVPNOperations } from "../components/home/hooks";
import { PrestartRepairModal } from "../components/home/prestart-repair-modal";
import { useSubscriptions, useProxyServers } from "../hooks/useDB";

export default function HomePage() {
    const { data: subscriptions } = useSubscriptions();
    const { initializeMode } = useProxyMode();
    const { isLoading, isRunning, toggleService, restartService, repairState, onRepairSuccess } = useVPNOperations();
    const { data: servers } = useProxyServers();
    const isEmpty = !subscriptions?.length && !servers?.length;

    useEffect(() => { initializeMode(); }, []);

    const handleUpdate = async () => { if (isLoading || isRunning) await restartService(isEmpty); };

    return (
        <div className="page-body" style={{height:"100%"}}>
            <PrestartRepairModal visible={repairState.visible} orphanPids={repairState.orphanPids} onSuccess={onRepairSuccess} onClose={() => {}} />
            <Body isRunning={Boolean(isRunning)} isLoading={isLoading} onUpdate={handleUpdate} onToggle={() => toggleService(isEmpty)} />
        </div>
    );
}
