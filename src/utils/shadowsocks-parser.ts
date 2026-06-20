/**
 * Proxy share-link parser. Supports ss://, socks5://, and http:// URIs.
 *
 * ss:// formats:
 *   1. SIP002:         ss://base64(method:password)@server:port#name
 *   2. Legacy:         ss://base64(method:password@server:port)#name
 *   3. Plain-text:     ss://method:password@server:port#name
 *   4. JSON userinfo:  ss://base64({"method":"...",...})@server:port#name
 *
 * socks5:// format:
 *   socks5://[username:password@]server:port[#name]
 *
 * http:// format:
 *   http://[username:password@]server:port[#name]
 */

export type ProxyType = "ss" | "socks5" | "http" | "vless" | "trojan" | "hysteria2";

export interface ParsedProxyServer {
  name: string;
  server: string;
  port: number;
  password: string;
  method: string;
  plugin: string;
  pluginOpts: string;
  proxyType: ProxyType;
  username: string;
  /** VLESS-specific fields — serialized from URI query params */
  vlessUUID?: string;
  vlessOpts?: Record<string, unknown>;
}

// Backward-compatible alias
export type ParsedSSServer = ParsedProxyServer;

const SUPPORTED_METHODS = new Set([
  "aes-256-gcm",
  "aes-128-gcm",
  "chacha20-ietf-poly1305",
  "xchacha20-ietf-poly1305",
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "none",
]);

function tryBase64Decode(s: string): string | null {
  if (!s || s.length === 0) return null;
  try {
    let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) normalized += "=";
    const decoded = atob(normalized);
    const printable = decoded.replace(/[\x20-\x7e\n\r:@.#/[\]]/g, "");
    if (printable.length > decoded.length * 0.3) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parseHostPart(
  addrPart: string
): { server: string; port: number } | null {
  let server: string;
  let portStr: string | undefined;
  if (addrPart.startsWith("[") && addrPart.includes("]")) {
    const endBracket = addrPart.indexOf("]");
    server = addrPart.slice(1, endBracket);
    const rest = addrPart.slice(endBracket + 1);
    if (rest.startsWith(":")) portStr = rest.slice(1);
  } else {
    const colonIdx = addrPart.lastIndexOf(":");
    if (colonIdx >= 0) {
      server = addrPart.slice(0, colonIdx);
      portStr = addrPart.slice(colonIdx + 1);
    } else {
      server = addrPart;
    }
  }
  const port = portStr ? parseInt(portStr, 10) : null;
  if (!server || port === null || isNaN(port) || port < 1 || port > 65535)
    return null;
  return { server, port };
}

function parseUserinfo(
  userinfo: string
): { method: string; password: string; plugin: string; pluginOpts: string } | null {
  const parts = userinfo.split(":");
  if (parts.length < 2) return null;
  const method = parts[0].toLowerCase();
  if (!SUPPORTED_METHODS.has(method)) return null;
  if (parts[0].startsWith("{") || userinfo.startsWith("{")) {
    try {
      const obj = JSON.parse(userinfo);
      return {
        method: (obj.method || "").toLowerCase(),
        password: obj.password || "",
        plugin: obj.plugin || "",
        pluginOpts: obj.plugin_opts || obj.pluginOpts || "",
      };
    } catch { /* fall through */ }
  }
  const is2022 = method.startsWith("2022-");
  // SS 2022: parts[2] is uPSK, not plugin — combine into password
  const password = is2022 ? parts.slice(1).join(":") : (parts[1] || "");
  const plugin = is2022 ? "" : (parts[2] || "");
  const pluginOpts = is2022 ? "" : parts.slice(3).join(":") || "";
  if (!SUPPORTED_METHODS.has(method)) return null;
  return { method, password, plugin, pluginOpts };
}

// ── ss:// parser ──────────────────────────────────────────────────────

export function parseSSLink(link: string): ParsedProxyServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("ss://")) return null;
  const raw = trimmed.slice(5);
  if (!raw) return null;

  const hashIdx = raw.indexOf("#");
  const preFragment = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const fragment = hashIdx >= 0 ? raw.slice(hashIdx + 1) : "";

  // Legacy: entire payload is base64
  if (!preFragment.includes("@")) {
    const decoded = tryBase64Decode(preFragment);
    if (decoded) return parseDecodedSSPayload(decoded, fragment);
    return null;
  }

  // SIP002
  const atIdx = raw.lastIndexOf("@");
  if (atIdx === -1) return null;
  const userinfoRaw = raw.slice(0, atIdx);
  const hostPartRaw = raw.slice(atIdx + 1);
  let hostPart = hostPartRaw;
  let name = "";
  const hIdx = hostPart.indexOf("#");
  if (hIdx >= 0) {
    hostPart = hostPart.slice(0, hIdx);
    try { name = decodeURIComponent(hostPartRaw.slice(hIdx + 1)); } catch { name = hostPartRaw.slice(hIdx + 1); }
  }
  const host = parseHostPart(hostPart);
  if (!host) return null;
  let userinfo = tryBase64Decode(userinfoRaw) ?? userinfoRaw;
  if (userinfo.startsWith("ss://")) userinfo = userinfo.slice(5);
  const ui = parseUserinfo(userinfo);
  if (!ui) return null;
  if (fragment && !name) { try { name = decodeURIComponent(fragment); } catch { name = fragment; } }
  return {
    name: name || `${host.server}:${host.port}`,
    server: host.server, port: host.port,
    password: ui.password, method: ui.method,
    plugin: ui.plugin, pluginOpts: ui.pluginOpts,
    proxyType: "ss", username: "",
  };
}

function parseDecodedSSPayload(decoded: string, fragment: string): ParsedProxyServer | null {
  let payload = decoded;
  if (payload.startsWith("ss://")) payload = payload.slice(5);
  const atIdx = payload.lastIndexOf("@");
  if (atIdx === -1) return null;
  const userinfo = payload.slice(0, atIdx);
  let hostPart = payload.slice(atIdx + 1);
  if (hostPart.includes("#")) {
    const hIdx = hostPart.indexOf("#");
    if (!fragment) fragment = hostPart.slice(hIdx + 1);
    hostPart = hostPart.slice(0, hIdx);
  }
  const host = parseHostPart(hostPart);
  if (!host) return null;
  const ui = parseUserinfo(userinfo);
  if (!ui) return null;
  let name = "";
  if (fragment) { try { name = decodeURIComponent(fragment); } catch { name = fragment; } }
  return {
    name: name || `${host.server}:${host.port}`,
    server: host.server, port: host.port,
    password: ui.password, method: ui.method,
    plugin: ui.plugin, pluginOpts: ui.pluginOpts,
    proxyType: "ss", username: "",
  };
}

// ── socks5:// parser ──────────────────────────────────────────────────

export function parseSocks5Link(link: string): ParsedProxyServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("socks5://")) return null;
  return parseSimpleProxyLink(trimmed.slice(9), "socks5");
}

// ── http:// parser ────────────────────────────────────────────────────

export function parseHttpLink(link: string): ParsedProxyServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("http://")) return null;
  return parseSimpleProxyLink(trimmed.slice(7), "http");
}

/**
 * Parse a simple proxy URI: [username:password@]server:port[#name]
 */
function parseSimpleProxyLink(raw: string, proxyType: ProxyType): ParsedProxyServer | null {
  let name = "";
  let remaining = raw;
  const hashIdx = remaining.indexOf("#");
  if (hashIdx >= 0) {
    try { name = decodeURIComponent(remaining.slice(hashIdx + 1)); } catch { name = remaining.slice(hashIdx + 1); }
    remaining = remaining.slice(0, hashIdx);
  }

  let username = "", password = "";
  const atIdx = remaining.lastIndexOf("@");
  let hostStr = remaining;
  if (atIdx !== -1) {
    const userinfo = remaining.slice(0, atIdx);
    hostStr = remaining.slice(atIdx + 1);
    const colonIdx = userinfo.indexOf(":");
    if (colonIdx >= 0) {
      username = decodeURIComponent(userinfo.slice(0, colonIdx));
      password = decodeURIComponent(userinfo.slice(colonIdx + 1));
    } else {
      username = decodeURIComponent(userinfo);
    }
  }

  const host = parseHostPart(hostStr);
  if (!host) return null;

  return {
    name: name || `${host.server}:${host.port}`,
    server: host.server, port: host.port,
    password, method: "",
    plugin: "", pluginOpts: "",
    proxyType, username,
  };
}

// ── vless:// parser ──────────────────────────────────────────────────

/**
 * Parse a VLESS share link.
 * Format: vless://uuid@server:port?param=value&...#name
 *
 * Common params: type, security, encryption, flow, sni, alpn, fingerprint,
 * publicKey, shortId, spiderX, path, host, serviceName, mode, headerType
 */
export function parseVlessLink(link: string): ParsedProxyServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("vless://")) return null;
  const rest = trimmed.slice(8);
  const atIdx = rest.lastIndexOf("@");
  if (atIdx === -1) return null;
  const uuid = rest.slice(0, atIdx);
  if (!uuid.trim()) return null;
  return parseVlessStyleHost(rest.slice(atIdx + 1), uuid, "vless");
}

// ── trojan:// parser ─────────────────────────────────────────────────

/**
 * Parse a Trojan share link.
 * Format: trojan://password@server:port?param=value&...#name
 */
export function parseTrojanLink(link: string): ParsedProxyServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("trojan://")) return null;
  const rest = trimmed.slice(9);
  const atIdx = rest.lastIndexOf("@");
  if (atIdx === -1) return null;
  const password = rest.slice(0, atIdx);
  if (!password.trim()) return null;
  return parseVlessStyleHost(rest.slice(atIdx + 1), password, "trojan");
}

// ── hysteria2:// parser ──────────────────────────────────────────────

/**
 * Parse a Hysteria2 share link.
 * Format: hysteria2://password@server:port?param=value&...#name
 *         hysteria2://username:password@server:port?...#name
 *
 * Common params: sni, insecure (0/1), obfs, obfs-password,
 * alpn, fingerprint, pinSHA256, upmbps, downmbps
 */
export function parseHysteria2Link(link: string): ParsedProxyServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("hysteria2://") && !trimmed.startsWith("hy2://")) return null;

  const schemeLen = trimmed.startsWith("hysteria2://") ? 12 : 6;
  const rest = trimmed.slice(schemeLen);
  const atIdx = rest.lastIndexOf("@");
  if (atIdx === -1) return null;

  let username = "";
  let password = rest.slice(0, atIdx);
  const colonIdx = password.indexOf(":");
  if (colonIdx >= 0) {
    username = decodeURIComponent(password.slice(0, colonIdx));
    password = password.slice(colonIdx + 1);
  }
  if (!password.trim()) return null;

  const result = parseVlessStyleHost(rest.slice(atIdx + 1), password, "hysteria2");
  if (!result) return null;
  result.username = username;
  result.password = password;
  return result;
}

/** Shared host parsing for vless:// and trojan:// URI patterns */
function parseVlessStyleHost(
  hostFull: string, credential: string, proxyType: ProxyType
): ParsedProxyServer | null {
  let name = "";
  let addrPart = hostFull;
  const hashIdx = addrPart.indexOf("#");
  if (hashIdx >= 0) {
    try { name = decodeURIComponent(addrPart.slice(hashIdx + 1)); } catch { name = addrPart.slice(hashIdx + 1); }
    addrPart = addrPart.slice(0, hashIdx);
  }

  let queryStr = "";
  const qIdx = addrPart.indexOf("?");
  if (qIdx >= 0) {
    queryStr = addrPart.slice(qIdx + 1);
    addrPart = addrPart.slice(0, qIdx);
  }

  const host = parseHostPart(addrPart);
  if (!host) return null;

  const opts: Record<string, string> = {};
  if (queryStr) {
    for (const p of queryStr.split("&")) {
      const eq = p.indexOf("=");
      if (eq >= 0) {
        try { opts[p.slice(0, eq)] = decodeURIComponent(p.slice(eq + 1)); } catch { opts[p.slice(0, eq)] = p.slice(eq + 1); }
      }
    }
  }

  return {
    name: name || `${host.server}:${host.port}`,
    server: host.server, port: host.port,
    password: proxyType === "trojan" ? credential : "",
    method: "",
    plugin: "", pluginOpts: "",
    proxyType,
    username: "",
    vlessUUID: proxyType === "vless" ? credential : undefined,
    vlessOpts: opts,
  };
}

// ── Auto-detect and batch parse ──────────────────────────────────────

export function parseProxyLink(link: string): ParsedProxyServer | null {
  const trimmed = link.trim();
  if (trimmed.startsWith("hysteria2://") || trimmed.startsWith("hy2://")) return parseHysteria2Link(trimmed);
  if (trimmed.startsWith("trojan://")) return parseTrojanLink(trimmed);
  if (trimmed.startsWith("vless://")) return parseVlessLink(trimmed);
  if (trimmed.startsWith("ss://")) return parseSSLink(trimmed);
  if (trimmed.startsWith("socks5://")) return parseSocks5Link(trimmed);
  if (trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return parseHttpLink(trimmed);
  return null;
}

/**
 * Parse a block of text into ParsedProxyServer array.
 * Auto-detects protocol per line. Deduplicates by server:port.
 */
export function parseShareLinks(text: string): ParsedProxyServer[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedProxyServer[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseProxyLink(trimmed);
    if (parsed) {
      const dup = results.find(
        (r) => r.server === parsed.server && r.port === parsed.port
      );
      if (!dup) results.push(parsed);
    }
  }
  return results;
}

/**
 * Build a sing-box outbound JSON object from a parsed server.
 */
export function makeSingBoxOutbound(
  server: ParsedProxyServer & { identifier: string }
): Record<string, unknown> {
  const tag = `${server.proxyType}-${server.identifier.slice(0, 8)}`;

  switch (server.proxyType) {
    case "socks5":
      return {
        tag, type: "socks", server: server.server,
        server_port: server.port, version: "5",
        ...(server.username ? { username: server.username } : {}),
        ...(server.password ? { password: server.password } : {}),
        domain_resolver: "system",
      };
    case "http":
      return {
        tag, type: "http", server: server.server,
        server_port: server.port,
        ...(server.username ? { username: server.username } : {}),
        ...(server.password ? { password: server.password } : {}),
        domain_resolver: "system",
      };
    default: {
      // Shadowsocks
      const outbound: Record<string, unknown> = {
        tag, type: "shadowsocks", server: server.server,
        server_port: server.port, method: server.method,
        password: server.password, domain_resolver: "system",
      };
      if (server.plugin) {
        outbound.plugin = server.plugin;
        outbound.plugin_opts = server.pluginOpts;
      }
      return outbound;
    }
  }
}

/** @deprecated Use makeSingBoxOutbound instead */
export const makeSingBoxSSOutbound = makeSingBoxOutbound;
