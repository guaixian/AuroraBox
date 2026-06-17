/**
 * Shadowsocks SIP002 share-link parser.
 *
 * Supported format:
 *   ss://base64(method:password)@server:port#name
 *   ss://base64(method:password:plugin:plugin_opts)@server:port#name
 *
 * Legacy SIP002 single-param encoding where the userinfo is a single
 * base64 blob that we split on `:` after decoding. Also handles the
 * case where the userinfo is NOT base64-encoded (plain text).
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
 * Try to base64-decode a string. Returns null on failure.
 */
function tryBase64Decode(s: string): string | null {
  try {
    // Atob can handle both standard and URL-safe base64
    // after normalizing underscores and hyphens
    let normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if missing
    while (normalized.length % 4 !== 0) normalized += "=";
    return atob(normalized);
  } catch {
    return null;
  }
}

/**
 * Parse a single ss:// URI into a ParsedSSServer, or return null.
 */
export function parseSSLink(link: string): ParsedSSServer | null {
  const trimmed = link.trim();
  if (!trimmed.startsWith("ss://")) return null;

  // Strip ss://
  const raw = trimmed.slice(5);
  // Split on `@` to get userinfo and host parts
  const atIdx = raw.lastIndexOf("@");
  if (atIdx === -1) return null;

  const userinfoRaw = raw.slice(0, atIdx);
  const hostPart = raw.slice(atIdx + 1);

  // Parse host part: server:port[#name]
  let server: string;
  let port: number | null = null;
  let name = "";

  const hashIdx = hostPart.indexOf("#");
  const addrPart = hashIdx >= 0 ? hostPart.slice(0, hashIdx) : hostPart;
  if (hashIdx >= 0) {
    try {
      name = decodeURIComponent(hostPart.slice(hashIdx + 1));
    } catch {
      name = hostPart.slice(hashIdx + 1);
    }
  }

  // Split addrPart on `:` to get server and port
  // Handle IPv6 addresses: [::1]:8388
  let serverPort = addrPart;
  if (serverPort.startsWith("[") && serverPort.includes("]")) {
    const endBracket = serverPort.indexOf("]");
    server = serverPort.slice(1, endBracket);
    const rest = serverPort.slice(endBracket + 1);
    if (rest.startsWith(":")) {
      port = parseInt(rest.slice(1), 10);
    }
  } else {
    const colonIdx = serverPort.lastIndexOf(":");
    if (colonIdx >= 0) {
      server = serverPort.slice(0, colonIdx);
      port = parseInt(serverPort.slice(colonIdx + 1), 10);
    } else {
      server = serverPort;
    }
  }

  if (!server || !port || isNaN(port) || port < 1 || port > 65535) return null;

  // Parse userinfo: try base64 decode first, fall back to plain text
  let userinfo = tryBase64Decode(userinfoRaw) ?? userinfoRaw;
  // Remove optional leading "ss://" if userinfo was re-encoded
  if (userinfo.startsWith("ss://")) userinfo = userinfo.slice(5);

  const parts = userinfo.split(":");
  // Minimum: method:password (2 parts)
  if (parts.length < 2) return null;

  const method = parts[0].toLowerCase();
  const password = parts.slice(1).join(":"); // password may contain colons

  // Check if password part contains embedded plugin info
  // Extended format: password:plugin:pluginOpts
  // (already captured above since we join slice(1), but we need to detect it)
  // Try parsing method:password@server:port first (simple case)
  // Also handle: method:password:plugin:plugin_opts@server:port
  let actualPassword = password;
  let plugin = "";
  let pluginOpts = "";

  if (parts.length >= 3) {
    actualPassword = parts[1];
    plugin = parts[2] || "";
    pluginOpts = parts.slice(3).join(":") || "";
  }

  if (!SUPPORTED_METHODS.has(method)) {
    return null;
  }

  return {
    name: name || `${server}:${port}`,
    server,
    port,
    password: actualPassword,
    method,
    plugin,
    pluginOpts,
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
