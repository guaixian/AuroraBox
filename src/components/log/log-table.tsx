interface LogEntry {
    message: string;
    timestamp: string;
    type?: string;
    payload?: string;
}

interface LogTableProps {
    logs: LogEntry[];
    filter: string;
    highlightText: (text: string, highlight: string) => React.ReactNode;
}

export default function LogTable({ logs, filter, highlightText }: LogTableProps) {
    return (
        <div className="py-2 aurorabox-selectable">
            {logs.map((log, index) => (
                <div key={`${log.timestamp}-${index}`} className="aurorabox-logrow">
                    <span className="aurorabox-logrow-time">{log.timestamp}</span>
                    <span className="flex-1 min-w-0">
                        {highlightText(log.message, filter)}
                    </span>
                </div>
            ))}
        </div>
    );
}
