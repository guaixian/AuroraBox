import type { ProxyServer } from "../types/definition";

export function buildOutboundJSON(s: ProxyServer): Record<string, unknown> {
    const ptype = (s.proxy_type || "ss") as string;
    const tag = `${ptype}-${(s as any).identifier?.slice(0, 8) || "00000000"}`;
    const base: Record<string, unknown> = { tag, server: s.server_address, server_port: s.server_port, domain_resolver: "system" };
    switch (ptype) {
        case "hysteria2": {
            base.type = "hysteria2"; base.password = s.password;
            const hops = parseOpts((s as any).vless_opts);
            base.tls = { enabled: true, server_name: hops.sni || s.server_address, insecure: hops.insecure === "1" || hops.allowInsecure === "1" };
            if (hops.obfs) base.obfs = { type: "salamander", password: hops.obfs };
            break;
        }
        case "vless": {
            base.type = "vless"; base.uuid = (s as any).vless_uuid || "";
            const vopts = parseOpts((s as any).vless_opts);
            const sec = vopts.security || "none";
            if (sec !== "none") base.tls = { enabled: true, server_name: vopts.sni || "" };
            if (sec === "reality") base.tls = { ...(base.tls as any || {}), reality: { enabled: true, public_key: vopts.publicKey || "", short_id: vopts.shortId || "" } };
            if (vopts.flow) base.flow = vopts.flow;
            if (vopts.type && vopts.type !== "tcp") {
                const tp: Record<string, unknown> = { type: vopts.type };
                if (vopts.path) tp.path = vopts.path;
                if (vopts.host) tp.headers = { Host: vopts.host };
                base.transport = tp;
            }
            break;
        }
        case "trojan": {
            base.type = "trojan"; base.password = s.password;
            const topts = parseOpts((s as any).vless_opts);
            if (topts.security && topts.security !== "none") base.tls = { enabled: true, server_name: topts.sni || s.server_address };
            break;
        }
        case "socks5": base.type = "socks"; base.version = "5"; if (s.username) base.username = s.username; if (s.password) base.password = s.password; break;
        case "http": base.type = "http"; if (s.username) base.username = s.username; if (s.password) base.password = s.password; break;
        default: base.type = "shadowsocks"; base.method = s.encryption_method; base.password = s.password; break;
    }
    return base;
}

function parseOpts(raw: string): Record<string, string> {
    try { return JSON.parse(raw || "{}"); } catch { return {}; }
}
