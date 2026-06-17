import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { insertProxyServer, updateProxyServer } from "../../action/db";
import { t } from "../../utils/helper";
import { IOSTextField } from "../common/ios-text-field";
import { EncryptionSelect } from "./encryption-select";
import type { ProxyServer, ProxyType } from "../../types/definition";

function parseVlessOpts(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function buildVlessOpts(o: Record<string, string>): string {
  return JSON.stringify(o);
}

const PROXY_TYPES: { value: ProxyType; label: string }[] = [
  { value: "ss", label: "Shadowsocks" },
  { value: "trojan", label: "Trojan" },
  { value: "vless", label: "VLESS" },
  { value: "hysteria2", label: "Hysteria2" },
  { value: "socks5", label: "SOCKS5" },
  { value: "http", label: "HTTP" },
];

const VLESS_SECURITIES = ["none", "tls", "reality"];
const VLESS_TRANSPORTS = ["tcp", "ws", "grpc", "httpupgrade"];
const VLESS_FLOWS = ["", "xtls-rprx-vision"];

interface AddServerModalProps {
  visible: boolean;
  editServer?: ProxyServer | null;
  onClose: () => void;
  onSaved: () => void;
}

export function AddServerModal({ visible, editServer, onClose, onSaved }: AddServerModalProps) {
  const isEdit = !!editServer;
  const [name, setName] = useState("");
  const [proxyType, setProxyType] = useState<ProxyType>("ss");
  const [server, setServer] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState("aes-256-gcm");
  const [plugin, setPlugin] = useState("");
  const [pluginOpts, setPluginOpts] = useState("");
  // VLESS fields
  const [vlessUUID, setVlessUUID] = useState("");
  const [vlessSecurity, setVlessSecurity] = useState("none");
  const [vlessFlow, setVlessFlow] = useState("");
  const [vlessTransport, setVlessTransport] = useState("tcp");
  const [vlessPath, setVlessPath] = useState("");
  const [vlessHost, setVlessHost] = useState("");
  const [vlessSNI, setVlessSNI] = useState("");
  const [vlessFingerprint, setVlessFingerprint] = useState("");
  const [vlessRealityPK, setVlessRealityPK] = useState("");
  const [vlessRealitySID, setVlessRealitySID] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editServer) {
      setName(editServer.name);
      setProxyType((editServer.proxy_type || "ss") as ProxyType);
      setServer(editServer.server_address);
      setPort(String(editServer.server_port));
      setUsername(editServer.username || "");
      setPassword(editServer.password);
      setMethod(editServer.encryption_method || "aes-256-gcm");
      setPlugin(editServer.plugin || "");
      setPluginOpts(editServer.plugin_opts || "");
      // VLESS fields
      setVlessUUID(editServer.vless_uuid || "");
      const eOpts = parseVlessOpts(editServer.vless_opts || "{}");
      setVlessSecurity(eOpts.security || "none");
      setVlessFlow(eOpts.flow || "");
      setVlessTransport(eOpts.type || "tcp");
      setVlessPath(eOpts.path || "");
      setVlessHost(eOpts.host || "");
      setVlessSNI(eOpts.sni || "");
      setVlessFingerprint(eOpts.fingerprint || "");
      setVlessRealityPK(eOpts.publicKey || "");
      setVlessRealitySID(eOpts.shortId || "");
    } else {
      setName("");
      setProxyType("ss");
      setServer("");
      setPort("");
      setUsername("");
      setPassword("");
      setMethod("aes-256-gcm");
      setPlugin("");
      setPluginOpts("");
      setVlessUUID("");
      setVlessSecurity("none"); setVlessFlow(""); setVlessTransport("tcp");
      setVlessPath(""); setVlessHost(""); setVlessSNI("");
      setVlessFingerprint(""); setVlessRealityPK(""); setVlessRealitySID("");
    }
    setError("");
  }, [editServer, visible]);

  if (!visible) return null;

  const isSS = proxyType === "ss";
  const isVLESS = proxyType === "vless";
  const isTrojan = proxyType === "trojan";
  const isAdvanced = isVLESS || isTrojan;

  const handleSave = async () => {
    setError("");
    if (!name.trim()) { setError(t("name_cannot_empty") || "Name cannot be empty"); return; }
    if (!server.trim()) { setError(t("server_cannot_empty") || "Server cannot be empty"); return; }
    const portNum = parseInt(port, 10);
    if (!port || isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError(t("invalid_port") || "Invalid port (1-65535)"); return;
    }
    if ((isSS || isTrojan) && !password.trim()) { setError(t("password_cannot_empty") || "Password cannot be empty"); return; }
    if (isVLESS && !vlessUUID.trim()) { setError("VLESS UUID cannot be empty"); return; }

    setSaving(true);
    try {
      const vlessOptsJson = isAdvanced ? buildVlessOpts({
        security: vlessSecurity,
        flow: vlessFlow,
        type: vlessTransport,
        ...(vlessPath ? { path: vlessPath } : {}),
        ...(vlessHost ? { host: vlessHost } : {}),
        ...(vlessSNI ? { sni: vlessSNI } : {}),
        ...(vlessFingerprint ? { fingerprint: vlessFingerprint } : {}),
        ...(vlessRealityPK ? { publicKey: vlessRealityPK } : {}),
        ...(vlessRealitySID ? { shortId: vlessRealitySID } : {}),
      }) : "";

      const data: any = {
        name: name.trim(),
        server_address: server.trim(),
        server_port: portNum,
        password: password.trim(),
        encryption_method: isSS ? method : "",
        plugin: isSS ? plugin.trim() : "",
        plugin_opts: isSS ? pluginOpts.trim() : "",
        proxy_type: proxyType,
        username: username.trim(),
        vless_uuid: isVLESS ? vlessUUID.trim() : "",
        vless_opts: isAdvanced ? vlessOptsJson : "",
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
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <motion.div
          className="relative bg-[var(--aurorabox-card)] rounded-2xl w-full max-w-md mx-4 p-6 shadow-lg"
          initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        >
          <h2 className="text-lg font-semibold mb-4 text-[var(--aurorabox-label)]">
            {isEdit ? t("edit_server") : t("add_server")}
          </h2>

          <div className="flex flex-col gap-3">
            {/* Proxy type selector */}
            <div className="aurorabox-form-field">
              <label className="aurorabox-form-label">{t("proxy_type")}</label>
              <div className="flex gap-1">
                {PROXY_TYPES.map((pt) => (
                  <button
                    key={pt.value}
                    onClick={() => setProxyType(pt.value)}
                    className={`flex-1 py-2 text-sm rounded-lg font-medium transition-colors ${
                      proxyType === pt.value
                        ? "bg-[var(--aurorabox-blue)] text-white"
                        : "bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label-secondary)]"
                    }`}
                  >
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>

            <IOSTextField placeholder={t("server_name")} value={name} onChange={(v) => setName(v)} />
            <IOSTextField placeholder={t("server_address")} value={server} onChange={(v) => setServer(v)} />
            <IOSTextField placeholder={t("port")} value={port} onChange={(v) => setPort(v)} />

            {/* Username (for socks5/http) */}
            {!isSS && (
              <IOSTextField placeholder={t("username_optional")} value={username} onChange={(v) => setUsername(v)} />
            )}

            <IOSTextField placeholder={t("password")} value={password} onChange={(v) => setPassword(v)} />

            {/* SS-specific fields */}
            {/* VLESS / Trojan advanced fields */}
            {isAdvanced && (
              <>
                {isVLESS && <IOSTextField placeholder="UUID" value={vlessUUID} onChange={(v) => setVlessUUID(v)} />}
                <div className="aurorabox-form-field">
                  <label className="aurorabox-form-label">Security</label>
                  <div className="flex gap-1">
                    {VLESS_SECURITIES.map((s) => (
                      <button key={s} onClick={() => setVlessSecurity(s)}
                        className={`flex-1 py-1.5 text-xs rounded-lg font-medium ${
                          vlessSecurity === s ? "bg-[var(--aurorabox-blue)] text-white" : "bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label-secondary)]"
                        }`}>{s}</button>
                    ))}
                  </div>
                </div>
                {vlessSecurity !== "none" && (
                  <IOSTextField placeholder="SNI (server name)" value={vlessSNI} onChange={(v) => setVlessSNI(v)} />
                )}
                {vlessSecurity === "reality" && (
                  <>
                    <IOSTextField placeholder="Public Key" value={vlessRealityPK} onChange={(v) => setVlessRealityPK(v)} />
                    <IOSTextField placeholder="Short ID" value={vlessRealitySID} onChange={(v) => setVlessRealitySID(v)} />
                  </>
                )}
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-[var(--aurorabox-label-secondary)]">Flow:</span>
                  <select value={vlessFlow} onChange={(e) => setVlessFlow(e.target.value)}
                    className="aurorabox-select flex-1 text-xs">
                    {VLESS_FLOWS.map((f) => <option key={f} value={f}>{f || "none"}</option>)}
                  </select>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-[var(--aurorabox-label-secondary)]">Transport:</span>
                  <select value={vlessTransport} onChange={(e) => setVlessTransport(e.target.value)}
                    className="aurorabox-select flex-1 text-xs">
                    {VLESS_TRANSPORTS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {vlessTransport === "ws" && (
                  <>
                    <IOSTextField placeholder="Path (e.g. /ws)" value={vlessPath} onChange={(v) => setVlessPath(v)} />
                    <IOSTextField placeholder="Host (header)" value={vlessHost} onChange={(v) => setVlessHost(v)} />
                  </>
                )}
                {vlessTransport === "grpc" && (
                  <IOSTextField placeholder="Service Name" value={vlessPath} onChange={(v) => setVlessPath(v)} />
                )}
                {vlessTransport === "httpupgrade" && (
                  <>
                    <IOSTextField placeholder="Path" value={vlessPath} onChange={(v) => setVlessPath(v)} />
                    <IOSTextField placeholder="Host" value={vlessHost} onChange={(v) => setVlessHost(v)} />
                  </>
                )}
                <IOSTextField placeholder="Fingerprint (e.g. chrome)" value={vlessFingerprint} onChange={(v) => setVlessFingerprint(v)} />
              </>
            )}

            {isSS && (
              <>
                <EncryptionSelect value={method} onChange={setMethod} />
                <IOSTextField placeholder={t("plugin_optional")} value={plugin} onChange={(v) => setPlugin(v)} />
                <IOSTextField placeholder={t("plugin_opts_optional")} value={pluginOpts} onChange={(v) => setPluginOpts(v)} />
              </>
            )}
          </div>

          {error && <p className="mt-3 text-sm text-[var(--aurorabox-red)]">{error}</p>}

          <div className="flex justify-end gap-3 mt-5">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-fill)] text-[var(--aurorabox-label)] hover:brightness-95">
              {t("cancel")}
            </button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-[var(--aurorabox-blue)] text-white disabled:opacity-50">
              {saving ? t("saving") : t("save")}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
