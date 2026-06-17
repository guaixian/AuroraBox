import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { insertProxyServer, updateProxyServer } from "../../action/db";
import { t } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import { EncryptionSelect } from "./encryption-select";
import type { ProxyServer } from "../../types/definition";

interface AddServerModalProps {
  visible: boolean;
  editServer?: ProxyServer | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AddServerModal({ visible, editServer, onClose, onSaved }: AddServerModalProps) {
  const isEdit = !!editServer;
  const [name, setName] = useState("");
  const [server, setServer] = useState("");
  const [port, setPort] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState("aes-256-gcm");
  const [plugin, setPlugin] = useState("");
  const [pluginOpts, setPluginOpts] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editServer) {
      setName(editServer.name);
      setServer(editServer.server_address);
      setPort(String(editServer.server_port));
      setPassword(editServer.password);
      setMethod(editServer.encryption_method);
      setPlugin(editServer.plugin || "");
      setPluginOpts(editServer.plugin_opts || "");
    } else {
      setName("");
      setServer("");
      setPort("");
      setPassword("");
      setMethod("aes-256-gcm");
      setPlugin("");
      setPluginOpts("");
    }
    setError("");
  }, [editServer, visible]);

  if (!visible) return null;

  const handleSave = async () => {
    setError("");
    if (!name.trim()) { setError(t("name_cannot_empty") || "Name cannot be empty"); return; }
    if (!server.trim()) { setError(t("server_cannot_empty") || "Server cannot be empty"); return; }
    const portNum = parseInt(port, 10);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError(t("invalid_port") || "Invalid port (1-65535)");
      return;
    }
    if (!password.trim()) { setError(t("password_cannot_empty") || "Password cannot be empty"); return; }

    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        server_address: server.trim(),
        server_port: portNum,
        password: password.trim(),
        encryption_method: method,
        plugin: plugin.trim(),
        plugin_opts: pluginOpts.trim(),
      };
      if (isEdit && editServer) {
        await updateProxyServer(editServer.identifier, data);
      } else {
        await insertProxyServer(data);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

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
          className="relative bg-[var(--aurorabox-card)] rounded-2xl w-full max-w-md mx-4 p-6 shadow-lg"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
        >
          <h2 className="text-lg font-semibold mb-4 text-[var(--aurorabox-label)]">
            {isEdit ? t("edit_server") : t("add_server")}
          </h2>

          <div className="flex flex-col gap-3">
            <IOSTextField
              placeholder={t("server_name")}
              value={name}
              onChange={(v) => setName(v)}
            />
            <IOSTextField
              placeholder={t("server_address")}
              value={server}
              onChange={(v) => setServer(v)}
            />
            <IOSTextField
              placeholder={t("port")}
              value={port}
              onChange={(v) => setPort(v)}
            />
            <IOSTextField
              placeholder={t("password")}
              value={password}
              onChange={(v) => setPassword(v)}
            />
            <EncryptionSelect value={method} onChange={setMethod} />
            <IOSTextField
              placeholder={t("plugin_optional")}
              value={plugin}
              onChange={(v) => setPlugin(v)}
            />
            <IOSTextField
              placeholder={t("plugin_opts_optional")}
              value={pluginOpts}
              onChange={(v) => setPluginOpts(v)}
            />
          </div>

          {error && (
            <p className="mt-3 text-sm text-[var(--aurorabox-red)]">{error}</p>
          )}

          <div className="flex justify-end gap-3 mt-5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95"
            >
              {t("cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-blue)] text-white disabled:opacity-50"
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
