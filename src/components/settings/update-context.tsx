import { type Update } from '@tauri-apps/plugin-updater';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { getStoreValue } from '../../single/store';
import { STAGE_VERSION_STORE_KEY } from '../../types/definition';
import {
    checkUpdate,
    downloadUpdateIfNeeded,
    getLastUpdateCheckTime,
    getSignatureThrottleUntil,
    getUpdateInterval,
    isSignatureVerificationError,
    setLastSignatureFailureTime,
    setLastUpdateCheckTime,
    SIGNATURE_FAILURE_COOLDOWN_MS,
} from '../../utils/update';

interface UpdateContextType {
    updateInfo: Update | null;
    downloading: boolean;
    lastCheckTime: number | null;
    downloadProgress: number;
    downloadComplete: boolean;
    // Timestamp (ms epoch) at which the stable-channel signature-failure
    // throttle expires, or 0 if not throttled.
    signatureThrottleUntil: number;
    checkAndDownloadUpdate: () => Promise<Update | null>;
    // Call after switching update channel. Reads the new channel's interval and
    // the persisted last-check timestamp; triggers an immediate check only if
    // the interval has elapsed.
    triggerImmediateCheck: () => Promise<void>;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

export function UpdateProvider({ children }: { children: ReactNode }) {
    const [downloadComplete, setDownloadComplete] = useState(false);
    const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);
    const [signatureThrottleUntil, setSignatureThrottleUntil] = useState(0);
    const checkingRef = useRef(false);
    const signatureThrottleUntilRef = useRef(0);

    const setSignatureThrottleUntilSync = (v: number) => {
        signatureThrottleUntilRef.current = v;
        setSignatureThrottleUntil(v);
    };
    // Refs mirror state so async closures always read current values,
    // avoiding stale captures in setTimeout callbacks.
    const downloadingRef = useRef(false);
    const downloadCompleteRef = useRef(false);

    const setDownloadingSync = (v: boolean) => {
        downloadingRef.current = v;
        setDownloading(v);
    };
    const setDownloadCompleteSync = (v: boolean) => {
        downloadCompleteRef.current = v;
        setDownloadComplete(v);
    };

    const checkAndDownloadUpdate = async () => {
        if (checkingRef.current) {
            console.log('Already checking for updates...');
            return updateInfo;
        }

        if (downloadCompleteRef.current) {
            console.log('Update already downloaded');
            return updateInfo;
        }

        if (downloadingRef.current) {
            console.log('Update is downloading...');
            return updateInfo;
        }

        if (signatureThrottleUntilRef.current > Date.now()) {
            console.log('Update check throttled after signature failure');
            return null;
        }

        checkingRef.current = true;
        console.log('Checking for updates...');

        try {
            const checkResult = await checkUpdate();
            if (checkResult) {
                setUpdateInfo(checkResult);
                setDownloadingSync(true);
                try {
                    await downloadUpdateIfNeeded(checkResult, setDownloadProgress);
                    setDownloadCompleteSync(true);
                    return checkResult;
                } catch (error) {
                    console.error('Download error:', error);
                    throw error;
                } finally {
                    setDownloadingSync(false);
                }
            }

            return null;
        } catch (error) {
            console.error('Error during update:', error);
            setDownloadingSync(false);
            if (isSignatureVerificationError(error)) {
                const stage = await getStoreValue(STAGE_VERSION_STORE_KEY, 'stable');
                if (stage === 'stable') {
                    const now = Date.now();
                    await setLastSignatureFailureTime(now);
                    setSignatureThrottleUntilSync(now + SIGNATURE_FAILURE_COOLDOWN_MS);
                }
            }
            return null;
        } finally {
            checkingRef.current = false;
            const now = Date.now();
            setLastCheckTime(now);
            await setLastUpdateCheckTime(now);
        }
    };

    // Called after the user switches update channel. Reads the new channel's
    // interval and the persisted last-check timestamp. If the interval has
    // elapsed, resets download state and triggers an immediate check.
    const triggerImmediateCheck = async () => {
        const [lastCheck, interval] = await Promise.all([
            getLastUpdateCheckTime(),
            getUpdateInterval(), // reads the newly saved stage from store
        ]);
        if (Date.now() - lastCheck >= interval) {
            setDownloadCompleteSync(false);
            setDownloadingSync(false);
            setUpdateInfo(null);
            setDownloadProgress(0);
            await checkAndDownloadUpdate();
        }
    };

    useEffect(() => {
        let cancelled = false;
        let timeoutId: ReturnType<typeof setTimeout>;

        // Poll every minute. Each tick re-reads lastCheckTime and the current
        // channel's interval from the store, so channel switches are picked up
        // automatically without needing to reschedule timers.
        const POLL_INTERVAL_MS = 60 * 1000;

        const poll = async () => {
            if (cancelled) return;

            if (!downloadingRef.current && !downloadCompleteRef.current) {
                const [lastCheck, interval] = await Promise.all([
                    getLastUpdateCheckTime(),
                    getUpdateInterval(),
                ]);

                if (lastCheck === 0) {
                    // No previous check recorded — first run ever.
                    await checkAndDownloadUpdate();
                } else {
                    const elapsed = Date.now() - lastCheck;
                    if (elapsed >= interval) {
                        await checkAndDownloadUpdate();
                    }
                }
            }

            if (!cancelled) {
                timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
            }
        };

        // Restore persisted last-check time for UI display, then start polling.
        getLastUpdateCheckTime().then((lastCheck) => {
            if (!cancelled && lastCheck > 0) {
                setLastCheckTime(lastCheck);
            }
        });

        // Restore signature-throttle expiry so a relaunch within the cooldown
        // window keeps the manual button disabled.
        getSignatureThrottleUntil().then((until) => {
            if (!cancelled && until > 0) {
                setSignatureThrottleUntilSync(until);
            }
        });

        poll();

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Clear the in-memory throttle once its absolute expiry has passed so the
    // UI re-enables the manual button without needing a re-render trigger.
    useEffect(() => {
        if (signatureThrottleUntil === 0) return;
        const remaining = signatureThrottleUntil - Date.now();
        if (remaining <= 0) {
            setSignatureThrottleUntilSync(0);
            return;
        }
        const id = setTimeout(() => setSignatureThrottleUntilSync(0), remaining);
        return () => clearTimeout(id);
    }, [signatureThrottleUntil]);

    return (
        <UpdateContext.Provider value={{
            updateInfo,
            downloadComplete,
            checkAndDownloadUpdate,
            triggerImmediateCheck,
            downloading,
            downloadProgress,
            lastCheckTime,
            signatureThrottleUntil,
        }}>
            {children}
        </UpdateContext.Provider>
    );
}

export function useUpdate() {
    const context = useContext(UpdateContext);
    if (context === undefined) {
        throw new Error('useUpdate must be used within an UpdateProvider');
    }
    return context;
}
