import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { batchInsertProxyServers } from "../../action/db";
import { parseShareLinks } from "../../utils/shadowsocks-parser";
import type { ParsedSSServer } from "../../utils/shadowsocks-parser";
import { t } from "../../utils/helper";

interface ImportShareLinksModalProps {
  visible: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function ImportShareLinksModal({ visible, onClose, onImported }: ImportShareLinksModalProps) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedSSServer[]>([]);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const handleParse = () => {
    const results = parseShareLinks(text);
    setParsed(results);
    setChecked(new Set(results.map((_, i) => i)));
    setError(results.length === 0 ? (t("no_valid_links") || "No valid share links found") : "");
  };

  const handleImport = async () => {
    if (checked.size === 0) return;
    setImporting(true);
    setError("");
    try {
      const selected = parsed
        .filter((_, i) => checked.has(i))
        .map((s) => ({
          name: s.name,
          server_address: s.server,
          server_port: s.port,
          password: s.password,
          encryption_method: s.method,
          plugin: s.plugin,
          plugin_opts: s.pluginOpts,
          proxy_type: s.proxyType || "ss",
          username: s.username || "",
          vless_uuid: s.vlessUUID || "",
          vless_opts: s.vlessOpts ? JSON.stringify(s.vlessOpts) : "",
        }));
      await batchInsertProxyServers(selected);
      onImported();
      onClose();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setImporting(false);
    }
  };

  const toggleCheck = (idx: number) => {
    const next = new Set(checked);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setChecked(next);
  };

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <motion.div
          className="relative bg-[var(--aurorabox-card)] rounded-2xl w-full max-w-lg mx-4 p-6 shadow-lg max-h-[80vh] flex flex-col"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
        >
          <h2 className="text-lg font-semibold mb-4 text-[var(--aurorabox-label)]">
            {t("batch_import_share_links")}
          </h2>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("paste_links_placeholder")}
            className="w-full h-28 rounded-lg border border-[var(--aurorabox-separator)] bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] text-sm p-3 resize-none outline-none focus:ring-2 focus:ring-[var(--aurorabox-blue)]/30"
          />

          <button
            onClick={handleParse}
            disabled={!text.trim()}
            className="mt-3 px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95 disabled:opacity-50 self-start"
          >
            {t("parse")}
          </button>

          {parsed.length > 0 && (
            <div className="mt-3 flex-1 overflow-y-auto border border-[var(--aurorabox-separator)] rounded-lg">
              <table className="w-full text-sm text-[var(--aurorabox-label)]">
                <thead className="sticky top-0 bg-[var(--aurorabox-card-muted)] text-[var(--aurorabox-label-secondary)] text-xs">
                  <tr>
                    <th className="p-2 text-left w-8">✓</th>
                    <th className="p-2 text-left">{t("name")}</th>
                    <th className="p-2 text-left">{t("server")}</th>
                    <th className="p-2 text-left">{t("port")}</th>
                    <th className="p-2 text-left">{t("method")}</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.map((s, i) => (
                    <tr
                      key={i}
                      className="border-t border-[var(--aurorabox-separator)] hover:bg-[var(--aurorabox-row-hover)] cursor-pointer"
                      onClick={() => toggleCheck(i)}
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={checked.has(i)}
                          onChange={() => toggleCheck(i)}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="p-2 truncate max-w-[120px]">{s.name}</td>
                      <td className="p-2 font-mono text-xs">{s.server}</td>
                      <td className="p-2">{s.port}</td>
                      <td className="p-2 text-xs">{s.method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-[var(--aurorabox-red)]">{error}</p>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"
            >
              {t("cancel")}
            </button>
            <button
              onClick={handleImport}
              disabled={checked.size === 0 || importing}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-blue)] text-white disabled:opacity-50"
            >
              {importing
                ? t("importing")
                : `${t("import")} (${checked.size}/${parsed.length})`}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
