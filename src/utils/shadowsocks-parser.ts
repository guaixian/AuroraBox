/**
 * Shadowsocks share-link parser.
 *
 * Supported formats:
 *
 *   1. SIP002 (userinfo base64, host plain):
 *        ss://base64(method:password)@server:port#name
 *        ss://base64(method:password:plugin:plugin_opts)@server:port#name
 *
 *   2. Legacy (entire payload base64, no visible @ before decode):
 *        ss://base64(method:password@server:port)
 *        ss://base64(method:password@server:port)#name
 *
 *   3. Plain-text userinfo (not base64):
 *        ss://method:password@server:port#name
 *
 *   4. SIP002 with JSON userinfo (rare):
 *        ss://base64({"method":"...","password":"..."})@server:port#name
 */

export interface ParsedSSServer {
  name: string;
  server: string;
  port: number;
  password: string;
  method: string;
  plugin: string;
  pluginOpts: string;
}

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

/**
 * Try to base64-decode a string. Handles standard, URL-safe, and
 * missing-padding variants. Returns null when the input cannot be
 * valid base64 at all (length check + decode trial).
 */
function tryBase64Decode(s: string): string | null {
  if (!s || s.length === 0) return null;

  try {
    // URL-safe → standard
    let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    // Restore padding
    while (normalized.length % 4 !== 0) normalized += "=";
    const decoded = atob(normalized);

    // Guard: if the decoded string contains mostly non-printable bytes
    // it's likely binary, not a URI component. Allow common printable
    // range plus newlines (some clients embed them).
    const printable = decoded.replace(/[\x20-\x7e\n\r:@.#/[\]]/g, "");
    if (printable.length > decoded.length * 0.3) {
      // >30% non-printable — probably not a text payload
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}

/** Parse server:port from a host-part string. Supports IPv6. */
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

/**
 * Parse userinfo (method:password[:plugin[:plugin_opts]]) into components.
 * The `password` slot may itself contain colons — we treat parts[0] as
 * method, parts[1] as password, and parts[2+] as plugin + plugin_opts.
 */
function parseUserinfo(
  userinfo: string
): { method: string; password: string; plugin: string; pluginOpts: string } | null {
  const parts = userinfo.split(":");
  if (parts.length < 2) return null; // need at least method:password

  const method = parts[0].toLowerCase();
  if (!SUPPORTED_METHODS.has(method)) return null;

  // If first part looks like JSON (SIP002 JSON userinfo), parse it
  if (parts[0].startsWith("{") || userinfo.startsWith("{")) {
    try {
      const obj = JSON.parse(userinfo);
      return {
        method: (obj.method || "").toLowerCase(),
        password: obj.password || "",
        plugin: obj.plugin || "",
        pluginOpts: obj.plugin_opts || obj.pluginOpts || "",
      };
    } catch {
      // fall through to colon-split
    }
  }

  const password = parts[1] || "";
  const plugin = parts[2] || "";
  const pluginOpts = parts.slice(3).join(":") || "";

  if (!SUPPORTED_METHODS.has(method)) return null;

  return { method, password, plugin, pluginOpts };
}

/**
 * Parse a single ss:// URI.
 */
export function parseSSLink(link: string): ParsedSSServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("ss://")) return null;

  const raw = trimmed.slice(5);
  if (!raw) return null;

  // ── Format A: Legacy — entire payload is one base64 blob ──────────
  //    ss://BASE64(method:password@server:port)
  //    ss://BASE64(method:password@server:port)#name
  //
  // Detect by the absence of an unencoded `@` before any `#`.
  const hashIdx = raw.indexOf("#");
  const preFragment = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw;
  const fragment = hashIdx >= 0 ? raw.slice(hashIdx + 1) : "";

  if (!preFragment.includes("@")) {
    // No @ in the raw string — try decoding the whole blob
    const decoded = tryBase64Decode(preFragment);
    if (decoded) {
      return parseDecodedPayload(decoded, fragment);
    }
    // If base64 decode failed, fall through and try as plain text below
  }

  // ── Format B: SIP002 — userinfo is base64, host is plain ──────────
  //    ss://base64(method:password)@server:port#name
  const atIdx = raw.lastIndexOf("@");
  if (atIdx === -1) return null;

  const userinfoRaw = raw.slice(0, atIdx);
  const hostPartRaw = raw.slice(atIdx + 1);

  // Extract #fragment from host part
  let hostPart = hostPartRaw;
  let name = "";
  const hIdx = hostPart.indexOf("#");
  if (hIdx >= 0) {
    hostPart = hostPart.slice(0, hIdx);
    try {
      name = decodeURIComponent(hostPartRaw.slice(hIdx + 1));
    } catch {
      name = hostPartRaw.slice(hIdx + 1);
    }
  }

  const host = parseHostPart(hostPart);
  if (!host) return null;

  // Try base64 decode the userinfo, fall back to plain text
  let userinfo = tryBase64Decode(userinfoRaw) ?? userinfoRaw;

  // Strip possible leading "ss://" in re-encoded payloads
  if (userinfo.startsWith("ss://")) userinfo = userinfo.slice(5);

  const ui = parseUserinfo(userinfo);
  if (!ui) return null;

  // Also parse fragment if it was attached before @ (legacy hybrid)
  if (fragment && !name) {
    try { name = decodeURIComponent(fragment); } catch { name = fragment; }
  }

  return {
    name: name || `${host.server}:${host.port}`,
    server: host.server,
    port: host.port,
    password: ui.password,
    method: ui.method,
    plugin: ui.plugin,
    pluginOpts: ui.pluginOpts,
  };
}

/**
 * Parse a fully-decoded payload string of the form:
 *   method:password@server:port
 *   method:password:plugin:plugin_opts@server:port
 *   ss://method:password@server:port  (redundant prefix)
 */
function parseDecodedPayload(
  decoded: string,
  fragment: string
): ParsedSSServer | null {
  let payload = decoded;
  // Strip redundant ss:// prefix if someone double-encoded
  if (payload.startsWith("ss://")) payload = payload.slice(5);

  const atIdx = payload.lastIndexOf("@");
  if (atIdx === -1) return null;

  const userinfo = payload.slice(0, atIdx);
  const hostPart = payload.slice(atIdx + 1);

  // Host part may still contain #fragment inside the base64
  let addrPart = hostPart;
  if (addrPart.includes("#")) {
    const hIdx = addrPart.indexOf("#");
    if (!fragment) fragment = addrPart.slice(hIdx + 1);
    addrPart = addrPart.slice(0, hIdx);
  }

  const host = parseHostPart(addrPart);
  if (!host) return null;

  const ui = parseUserinfo(userinfo);
  if (!ui) return null;

  let name = "";
  if (fragment) {
    try { name = decodeURIComponent(fragment); } catch { name = fragment; }
  }

  return {
    name: name || `${host.server}:${host.port}`,
    server: host.server,
    port: host.port,
    password: ui.password,
    method: ui.method,
    plugin: ui.plugin,
    pluginOpts: ui.pluginOpts,
  };
}

/**
 * Parse a block of text into an array of ParsedSSServer.
 * Accepts multiple URIs separated by newlines.
 * Valid entries are collected; invalid lines are silently skipped.
 */
export function parseShareLinks(text: string): ParsedSSServer[] {
  const lines = text.split(/\r?\n/);
  const results: ParsedSSServer[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = parseSSLink(trimmed);
    if (parsed) {
      // Deduplicate by server:port
      const dup = results.find(
        (r) => r.server === parsed.server && r.port === parsed.port
      );
      if (!dup) {
        results.push(parsed);
      }
    }
  }

  return results;
}

/**
 * Build a sing-box Shadowsocks outbound JSON object from a parsed server.
 */
export function makeSingBoxSSOutbound(
  server: ParsedSSServer & { identifier: string }
): Record<string, unknown> {
  const tag = `ss-${server.identifier.slice(0, 8)}`;
  const outbound: Record<string, unknown> = {
    tag,
    type: "shadowsocks",
    server: server.server,
    server_port: server.port,
    method: server.method,
    password: server.password,
    domain_resolver: "system",
  };
  if (server.plugin) {
    outbound.plugin = server.plugin;
    outbound.plugin_opts = server.pluginOpts;
  }
  return outbound;
}
