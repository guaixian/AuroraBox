import { useState } from "react";
import useSWR from "swr";
import { CloudPlus, Pencil, Server, Trash3 } from "react-bootstrap-icons";
import { deleteProxyServer, getProxyServers, setActiveProxyServer } from "../action/db";
import { GET_PROXY_SERVERS_SWR_KEY } from "../types/definition";
import type { ProxyServer } from "../types/definition";
import { t } from "../utils/helper";
import { AddServerModal } from "../components/servers/add-server-modal";
import { ImportShareLinksModal } from "../components/servers/import-share-links-modal";
import { toast } from "sonner";

function ServersPage() {
  const { data: servers, mutate } = useSWR(
    GET_PROXY_SERVERS_SWR_KEY,
    getProxyServers,
    { fallbackData: [] }
  );
  const [addVisible, setAddVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [editServer, setEditServer] = useState<ProxyServer | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = () => mutate();

  const handleDelete = async (identifier: string) => {
    try {
      await deleteProxyServer(identifier);
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleSetActive = async (identifier: string) => {
    try {
      await setActiveProxyServer(identifier);
      refresh();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleEdit = (s: ProxyServer) => {
    setEditServer(s);
    setAddVisible(true);
  };

  const handleAdd = () => {
    setEditServer(null);
    setAddVisible(true);
  };

  return (
    <div className="aurorabox-scrollpage">
      <div className="aurorabox-page-inner px-4 pt-6 pb-4">
        <h2 className="text-[22px] font-semibold text-[var(--aurorabox-label)] mb-1">
          {t("servers")}
        </h2>
        <p className="text-sm text-[var(--aurorabox-label-secondary)] mb-4">
          {t("servers_description")}
        </p>

        {/* Actions */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-blue)] text-white hover:brightness-110"
          >
            <CloudPlus size={16} />
            {t("add_server")}
          </button>
          <button
            onClick={() => setImportVisible(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"
          >
            {t("batch_import")}
          </button>
        </div>

        {/* Empty state */}
        {(!servers || servers.length === 0) && (
          <div className="flex flex-col items-center justify-center py-16 text-[var(--aurorabox-label-tertiary)]">
            <Server size={48} className="mb-3 opacity-40" />
            <p className="text-sm">{t("no_servers_yet")}</p>
            <button
              onClick={handleAdd}
              className="mt-3 px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"
            >
              {t("add_first_server")}
            </button>
          </div>
        )}

        {/* Server list */}
        <div className="aurorabox-grouped-card">
          {(servers ?? []).map((s) => (
            <div
              key={s.identifier}
              className="border-b border-[var(--aurorabox-separator)] last:border-b-0"
            >
              <button
                onClick={() => setExpandedId(expandedId === s.identifier ? null : s.identifier)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--aurorabox-row-hover)] transition-colors"
              >
                {/* Active indicator */}
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.is_active ? "bg-[var(--aurorabox-green)]" : "bg-[var(--aurorabox-fill-strong)]"}`} />

                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--aurorabox-label)] text-sm truncate">
                    {s.name}
                  </div>
                  <div className="text-xs text-[var(--aurorabox-label-secondary)] font-mono truncate">
                    {s.server_address}:{s.server_port} · {(s as any).proxy_type === 'socks5' ? 'SOCKS5' : (s as any).proxy_type === 'http' ? 'HTTP' : (s as any).proxy_type === 'vless' ? 'VLESS' : s.encryption_method}
                  </div>
                </div>

                {s.plugin && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label-secondary)] flex-shrink-0">
                    plugin
                  </span>
                )}
              </button>

              {/* Expanded actions */}
              {expandedId === s.identifier && (
                <div className="flex gap-1 px-4 pb-3">
                  {!s.is_active && (
                    <button
                      onClick={() => handleSetActive(s.identifier)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-green)]/10 text-[var(--aurorabox-green)] hover:brightness-95"
                    >
                      {t("set_active")}
                    </button>
                  )}
                  {s.is_active && (
                    <span className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-green)]/10 text-[var(--aurorabox-green)]">
                      {t("active")}
                    </span>
                  )}
                  <button
                    onClick={() => handleEdit(s)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"
                  >
                    <Pencil size={12} />
                    {t("edit")}
                  </button>
                  <button
                    onClick={() => handleDelete(s.identifier)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-[var(--aurorabox-red)]/10 text-[var(--aurorabox-red)] hover:brightness-95"
                  >
                    <Trash3 size={12} />
                    {t("delete")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <AddServerModal
        visible={addVisible}
        editServer={editServer}
        onClose={() => setAddVisible(false)}
        onSaved={refresh}
      />
      <ImportShareLinksModal
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onImported={refresh}
      />
    </div>
  );
}

export default ServersPage;
