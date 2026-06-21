import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowDownCircle, ArrowUpCircle, Copy, Search, Trash } from 'react-bootstrap-icons';
import { toast, Toaster } from 'sonner';
import ConfigTemplate from '../components/config-template/config-template';
import ConfigViewer from '../components/config-viewer/config-viewer';
import { useLogSource, useNetworkSpeed } from '../utils/clash-api';
import { initLanguage, t } from '../utils/helper';

type TabKey = 'logs' | 'config' | 'config-template';

const TABS: { key: TabKey; labelKey: string; fallback: string }[] = [
    { key: 'logs', labelKey: 'log_viewer', fallback: 'Logs' },
    { key: 'config', labelKey: 'config_viewer', fallback: 'Config' },
    { key: 'config-template', labelKey: 'config_template', fallback: 'Template' },
];

function Segments({ value, onChange }: { value: TabKey; onChange: (v: TabKey) => void }) {
    return (
        <div className="mode-bar" style={{marginBottom:14}}>
            {TABS.map(({ key, labelKey, fallback }) => (
                <button key={key} className={`mode-btn ${value === key ? "on" : ""}`} onClick={() => onChange(key)}>
                    {t(labelKey) || fallback}
                </button>
            ))}
        </div>
    );
}

export default function LogPage() {
    const [activeTab, setActiveTab] = useState<TabKey>('logs');
    const [query, setQuery] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);
    const [lockScroll, setLockScroll] = useState(false);
    const { logs: logLines, clearLogs } = useLogSource();
    const speed = useNetworkSpeed();
    const filteredLines = query ? (logLines || []).filter((l: any) => String(l.message || l).toLowerCase().includes(query.toLowerCase())) : (logLines || []);

    useEffect(() => { initLanguage(); }, []);
    useEffect(() => {
        if (lockScroll || !containerRef.current) return;
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }, [logLines, lockScroll]);

    const handleCopy = async () => {
        try { await navigator.clipboard.writeText(filteredLines.join('\n')); toast.success('Copied'); } catch { toast.error('Copy failed'); }
    };

    return (
        <div className="page-body" style={{height:'100%',display:'flex',flexDirection:'column'}}>
            <Toaster position="top-center" toastOptions={{ duration: 2000 }} />
            <Segments value={activeTab} onChange={setActiveTab} />

            {activeTab === 'logs' && (
                <div style={{flex:1,display:'flex',flexDirection:'column'}}>
                    <div className="toolbar">
                        <div className="grouped-list" style={{flex:1,display:'flex',alignItems:'center',padding:'2px 8px',borderRadius:'var(--r-sm)',gap:4}}>
                            <Search size={12} style={{color:'var(--text3)'}}/>
                            <input placeholder={t("filter_placeholder")} value={query} onChange={e => setQuery(e.target.value)}
                                style={{flex:1,border:'none',background:'none',fontSize:12,color:'var(--text)',outline:'none',fontFamily:'inherit'}}/>
                        </div>
                        <button className={`btn sm ${lockScroll ? "primary" : ""}`} onClick={() => setLockScroll(!lockScroll)}>
                            <ArrowDown size={12}/> {lockScroll ? 'Locked' : 'Auto'}
                        </button>
                        <button className="btn sm" onClick={handleCopy}><Copy size={12}/></button>
                        <button className="btn sm dang" onClick={clearLogs}><Trash size={12}/></button>
                    </div>
                    <div ref={containerRef} style={{flex:1,overflowY:'auto',fontSize:11,fontFamily:'var(--font-mono)',lineHeight:1.6,marginTop:8,background:'var(--bg-card)',borderRadius:'var(--r)',border:'0.5px solid var(--border)',padding:8}}>
                        {filteredLines.map((l: any, i: number) => (
                            <div key={i} style={{whiteSpace:'pre-wrap',wordBreak:'break-all',padding:'1px 0'}}>{l.message || String(l)}</div>
                        ))}
                    </div>
                    <div style={{display:'flex',gap:8,marginTop:8,fontSize:11,color:'var(--text2)'}}>
                        <span><ArrowDownCircle size={12}/> {(speed.download / 1024).toFixed(1)} KB/s</span>
                        <span><ArrowUpCircle size={12}/> {(speed.upload / 1024).toFixed(1)} KB/s</span>
                    </div>
                </div>
            )}

            {activeTab === 'config' && <ConfigViewer />}
            {activeTab === 'config-template' && <ConfigTemplate />}
        </div>
    );
}
