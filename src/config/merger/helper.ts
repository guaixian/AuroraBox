import { type } from '@tauri-apps/plugin-os';
import { getDirectDNS, getProxyPort, getStoreValue, getUseDHCP } from "../../single/store";
import { TUN_INTERFACE_NAME, TUN_STACK_STORE_KEY } from "../../types/definition";
import { writeConfigFile } from "../helper";

/** Parse a JSON string of VLESS options, falling back to empty object. */
function parseVlessOpts(raw: string): Record<string, string> {
    try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Strip remote rule_set entries and convert rule_set-based rules to
 * inline equivalents. This avoids the startup HTTP downloads that can
 * fail when CDNs are unreachable. The config is mutated in-place.
 *
 * Strategy: remove all rule_set entries and replace every rule that
 * references a rule_set with a simplified inline version.
 */
export function patchRuleSetCDN(config: any): void {
    const route = config?.route;
    if (!route) return;

    // Remove ALL remote rule_set entries — we only use inline rules
    if (route.rule_set) {
        route.rule_set = [];
    }

    // Replace rule_set-based rules with inline equivalents.
    // The templates use rule_set references like:
    //   { "rule_set": "geosite-cn", "outbound": "direct" }
    //   { "rule_set": "geoip-cn", "outbound": "direct" }
    //
    // We just drop them and rely on the default outbound (ExitGateway)
    // plus a few hard-coded direct-routing rules.
    if (route.rules && Array.isArray(route.rules)) {
        route.rules = route.rules.filter((r: any) => {
            // Keep rules that don't reference rule_sets
            if (r.rule_set) return false;
            // Keep DNS hijack, protocol sniffing, private-IP rules
            return true;
        });
    }

    // Inline key routing: private IPs → direct, rest → ExitGateway
    const inlineRules = [
        // DNS hijack prevention
        { "protocol": "dns", "outbound": "dns-out" },
        // Private & local IPs → direct
        {
            "ip_is_private": true,
            "outbound": "direct",
        },
        {
            "ip_cidr": [
                "10.0.0.0/8",
                "172.16.0.0/12",
                "192.168.0.0/16",
                "127.0.0.0/8",
                "224.0.0.0/4",
                "::1/128",
                "fc00::/7",
                "fe80::/10",
            ],
            "outbound": "direct",
        },
    ];

    // Prepend inline rules (higher priority)
    route.rules = [...inlineRules, ...(route.rules || [])];

    // Also strip rule_set references from DNS rules
    if (config.dns?.rules && Array.isArray(config.dns.rules)) {
        config.dns.rules = config.dns.rules.filter((r: any) => !r.rule_set);
    }
    // And from the DNS server list (used for domain-based server selection)
    if (config.dns?.servers && Array.isArray(config.dns.servers)) {
        for (const s of config.dns.servers) {
            if (s.rules && Array.isArray(s.rules)) {
                s.rules = s.rules.filter((r: any) => !r.rule_set);
            }
        }
    }
}



type Item = {
    tag: string;
    type: string;
}



export async function updateDHCPSettings2Config(newConfig: any) {
    const useDHCP = await getUseDHCP();
    for (let i = 0; i < newConfig.dns.servers.length; i++) {
        const server = newConfig.dns.servers[i];
        if (server.tag === "system") {
            if (useDHCP) {
                server.type = "dhcp";
                delete server.server;
                delete server.server_port;
                console.log("启用 DHCP DNS 模式");
            } else {
                let directDNS = await getDirectDNS();
                console.log("当前使用直连 DNS 地址：", directDNS);
                server.type = "udp";
                server.server = directDNS.trim();
                server.server_port = 53;
                console.log("启用 UDP DNS 模式, 服务器地址：", server.server);
            }
        }
    }
}

/**
 * 只提取 VPN 服务器节点配置合并到配置文件中
 */
export async function updateVPNServerConfigFromDB(fileName: string, dbConfigData: any, newConfig: any) {

    if (!dbConfigData?.outbounds) {
        throw new Error('subscription_config_missing');
    }

    const outboundsSelectorIndex = 1;
    const outboundsUrltestIndex = 2;

    const outbound_groups = newConfig["outbounds"];
    const outboundsSelector = outbound_groups[outboundsSelectorIndex]["outbounds"];
    const outboundsUrltest = outbound_groups[outboundsUrltestIndex]["outbounds"];


    const seenTags = new Set<string>();
    const vpnServerList = dbConfigData.outbounds.filter((item: Item) => {
        // zh: 只找VPN服务器的节点配置
        // en: Only find the node configuration of the VPN server
        let flag = item.type !== "selector" && item.type !== "urltest" && item.type !== "direct" && item.type !== "block";

        // zh: sing-box 1.12 版本开始，dns 类型的节点不再需要
        // en: From sing-box version 1.12, dns type nodes are no longer
        flag = flag && item.type !== "dns";

        // Deduplicate by tag: skip any server whose tag has already been seen.
        // This guards against duplicate tags in the remote subscription config and
        // any concurrent-write edge case that could produce the same tag twice.
        if (flag && seenTags.has(item.tag)) {
            console.warn(`[CONFIG] Skipping duplicate outbound tag: ${item.tag}`);
            return false;
        }
        if (flag) seenTags.add(item.tag);
        return flag;
    });

    for (let i = 0; i < vpnServerList.length; i++) {
        vpnServerList[i]["domain_resolver"] = "system";
        outboundsSelector.push(vpnServerList[i].tag);
    }

    const urltestNameList: string[] = vpnServerList.map((item: any) => item.tag);

    outboundsUrltest.push(...urltestNameList);

    outbound_groups.push(...vpnServerList);


    await writeConfigFile(fileName, new TextEncoder().encode(JSON.stringify(newConfig)));


}

export async function configureTunInbound(newConfig: any, bypassRouter: boolean = false): Promise<void> {
    const tunInbound = newConfig.inbounds.find((ib: Item) => ib.type === "tun" && ib.tag === "tun");
    if (!tunInbound) return;
    const proxyPort = await getProxyPort();

    if (tunInbound.platform?.http_proxy) {
        tunInbound.platform.http_proxy.server_port = proxyPort;
    }

    const osType = type();
    if (osType === "linux") {
        tunInbound.stack = "system";
    }
    // macOS 强制使用 gvisor stack，经过测试 system stack 无法正常运作
    if (osType !== "macos" && await getStoreValue(TUN_STACK_STORE_KEY)) {
        tunInbound.stack = await getStoreValue(TUN_STACK_STORE_KEY);
    }
    // macOS 固定接口名，退出时可精确清理该接口的路由
    if (osType === "macos") {
        tunInbound.interface_name = TUN_INTERFACE_NAME;
    }

    // 旁路由模式：其它主机以本机为网关/DNS 转发进来的包，源地址必然落在 RFC1918
    // 网段内。模板默认把这三段放进 route_exclude_address，会让 TUN 栈在进入 sing-box
    // 路由引擎之前就把包放掉，hijack-dns 永远不命中。启用旁路由时必须剔除。
    if (bypassRouter && Array.isArray(tunInbound.route_exclude_address)) {
        const lanRanges = new Set(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]);
        tunInbound.route_exclude_address = tunInbound.route_exclude_address.filter(
            (cidr: string) => !lanRanges.has(cidr),
        );
        // 华硕路由器的「WAN 中断浏览器导页通知」会在检测到外网异常时，把所有 DNS
        // 应答劫持成 10.0.0.1 的导页 IP（见 https://github.com/pymumu/smartdns/issues/541）。
        // 上面剔除 10.0.0.0/8 后，本机访问该 IP 的包会被 auto_route 吸进 TUN，
        // 形成自路由回环，dial 永远超时；单独把这一个 host 留在排除清单里。
        tunInbound.route_exclude_address.push("10.0.0.1/32");
    }

    // 旁路由模式：LAN 设备把 DNS 指向本机时，sing-box 需要在 UDP:53 上监听
    // 才能接收并 hijack 这些 DNS 请求。模板默认不含这个 inbound（普通 TUN
    // 模式下 DNS 通过 TUN 网关的 hijack-dns 路由规则拦截，不需要单独监听）。
    if (bypassRouter) {
        const hasDnsIn = newConfig.inbounds.some((ib: Item) => ib.tag === "dns-in");
        if (!hasDnsIn) {
            newConfig.inbounds.push({
                tag: "dns-in",
                type: "direct",
                listen: "::",
                listen_port: 53,
            });
            console.log("旁路由模式：注入 dns-in inbound ([::]:53)");
        }
    }

    console.log("当前 TUN Stack:", tunInbound.stack);
}

export async function configureMixedInbound(newConfig: any, allowLan: boolean, bypassRouter: boolean = false): Promise<void> {
    const mixedInbound = newConfig.inbounds.find((ib: Item) => ib.type === "mixed" && ib.tag === "mixed");
    if (mixedInbound) {
        mixedInbound.listen = (allowLan || bypassRouter) ? "0.0.0.0" : "127.0.0.1";
        mixedInbound.listen_port = await getProxyPort();
    }
}

/**
 * Merge manually-configured proxy servers (Shadowsocks, etc.) into the
 * sing-box config template. Appends each server as a sing-box outbound
 * and wires them into the ExitGateway selector and auto urltest group.
 *
 * The template's outbounds array is expected to have:
 *   [0] = direct
 *   [1] = selector (ExitGateway) with an "outbounds" array of tags
 *   [2] = urltest (auto) with an "outbounds" array of tags
 */
export async function mergeManualServersConfig(newConfig: any): Promise<void> {
    try {
        const { getProxyServers } = await import("../../action/db");
        const servers = await getProxyServers();
        if (!servers || servers.length === 0) return;

        const outbound_groups = newConfig["outbounds"];
        if (!outbound_groups || outbound_groups.length < 3) return;

        const selectorIdx = outbound_groups.findIndex(
            (g: any) => g.type === "selector" && g.tag === "ExitGateway"
        );
        const urltestIdx = outbound_groups.findIndex(
            (g: any) => g.type === "urltest" && g.tag === "auto"
        );
        if (selectorIdx === -1 || urltestIdx === -1) return;

        const outboundsSelector = outbound_groups[selectorIdx]["outbounds"];
        const outboundsUrltest = outbound_groups[urltestIdx]["outbounds"];

        let activeTag: string | null = null;

        for (const server of servers) {
            const ptype = (server as any).proxy_type || "ss";
            const tag = `${ptype}-${server.identifier.slice(0, 8)}`;

            const outbound: any = {
                tag,
                server: server.server_address,
                server_port: server.server_port,
                domain_resolver: "system",
            };

            switch (ptype) {
                case "hysteria2": {
                    outbound.type = "hysteria2";
                    outbound.password = server.password;
                    const hops = parseVlessOpts((server as any).vless_opts || "{}");
                    if (hops.upmbps) outbound.up_mbps = parseInt(hops.upmbps, 10) || 100;
                    if (hops.downmbps) outbound.down_mbps = parseInt(hops.downmbps, 10) || 200;
                    if (hops.obfs || hops["obfs-password"]) {
                        outbound.obfs = { type: "salamander", password: hops.obfs || hops["obfs-password"] };
                    }
                    // TLS
                    const tls: any = { enabled: true };
                    if (hops.sni) tls.server_name = hops.sni;
                    if (hops.insecure === "1" || hops.allowInsecure === "1") tls.insecure = true;
                    if (hops.alpn) tls.alpn = hops.alpn.split(",");
                    if (hops.pinSHA256) tls.pin_sha256 = hops.pinSHA256;
                    if (hops.fingerprint) tls.utls = { enabled: true, fingerprint: hops.fingerprint };
                    outbound.tls = tls;
                    break;
                }
                case "socks5":
                    outbound.type = "socks";
                    outbound.version = "5";
                    if ((server as any).username) outbound.username = (server as any).username;
                    if (server.password) outbound.password = server.password;
                    break;
                case "http":
                    outbound.type = "http";
                    if ((server as any).username) outbound.username = (server as any).username;
                    if (server.password) outbound.password = server.password;
                    break;
                case "trojan":
                case "vless": {
                    outbound.type = ptype;
                    const vuuid = (server as any).vless_uuid || "";
                    const vopts = parseVlessOpts((server as any).vless_opts || "{}");
                    if (ptype === "vless") {
                        outbound.uuid = vuuid;
                    } else {
                        outbound.password = server.password;
                    }
                    outbound.flow = vopts.flow || "";
                    if (ptype === "vless") outbound.packet_encoding = vopts.packetEncoding || "";

                    // TLS / Reality
                    const tls: any = {};
                    const security = vopts.security || "none";
                    if (security === "tls" || security === "xtls") {
                        tls.enabled = true;
                        if (vopts.sni) tls.server_name = vopts.sni;
                        if (vopts.alpn) tls.alpn = vopts.alpn.split(",");
                        if (vopts.fingerprint) {
                            tls.utls = { enabled: true, fingerprint: vopts.fingerprint };
                        }
                    } else if (security === "reality") {
                        tls.enabled = true;
                        tls.server_name = vopts.sni || "";
                        tls.reality = {
                            enabled: true,
                            public_key: vopts.publicKey || "",
                            short_id: vopts.shortId || "",
                        };
                        if (vopts.fingerprint) {
                            tls.utls = { enabled: true, fingerprint: vopts.fingerprint };
                        }
                    }
                    if (tls.enabled) outbound.tls = tls;

                    // Transport
                    const transport: any = {};
                    const tp = vopts.type || "tcp";
                    transport.type = tp;
                    if (tp === "ws") {
                        if (vopts.path) transport.path = vopts.path;
                        if (vopts.host) transport.headers = { Host: vopts.host };
                    } else if (tp === "grpc") {
                        if (vopts.serviceName) transport.service_name = vopts.serviceName;
                    } else if (tp === "httpupgrade") {
                        if (vopts.path) transport.path = vopts.path;
                        if (vopts.host) transport.host = vopts.host;
                    }
                    if (tp !== "tcp") outbound.transport = transport;

                    break;
                }
                default: // ss
                    outbound.type = "shadowsocks";
                    outbound.method = server.encryption_method;
                    outbound.password = server.password;
                    if (server.plugin) {
                        outbound.plugin = server.plugin;
                        outbound.plugin_opts = server.plugin_opts;
                    }
                    break;
            }

            // Avoid duplicate tags
            const existing = outbound_groups.find((g: any) => g.tag === tag);
            if (existing) continue;

            outboundsSelector.push(tag);
            outboundsUrltest.push(tag);
            outbound_groups.push(outbound);

            if (server.is_active) {
                activeTag = tag;
            }
        }

        // If there is an active server, move its tag to the front of the
        // selector so sing-box picks it as the default instead of "auto".
        if (activeTag) {
            const idx = outboundsSelector.indexOf(activeTag);
            if (idx > 0) {
                outboundsSelector.splice(idx, 1);
                outboundsSelector.unshift(activeTag);
            }
        }

        console.log(
            `[mergeManualServers] merged ${servers.length} manual server(s)` +
            (activeTag ? `, active=${activeTag}` : "")
        );

        // Write the final config — necessary when called without a preceding
        // updateVPNServerConfigFromDB (i.e. manual-servers-only mode).
        await writeConfigFile(
            "config.json",
            new TextEncoder().encode(JSON.stringify(newConfig))
        );
    } catch (e) {
        console.warn("[mergeManualServers] skipped — error:", e);
    }
}

/**
 * Merge proxy groups into sing-box config. Each group becomes a sing-box
 * outbound group (selector/urltest/chain) wired into ExitGateway.
 *
 * Group types:
 *   fixed  → selector with first server as default
 *   auto   → urltest with all member servers
 *   random → selector (frontend randomly picks on start)
 *   chain  → individual outbounds with detour linking 1→2→3
 */
export async function mergeProxyGroupsConfig(newConfig: any): Promise<void> {
    try {
        const { getProxyGroups, getServersByGroup } = await import("../../action/db");
        const groups = await getProxyGroups();
        if (!groups?.length) return;

        const outbounds: any[] = newConfig.outbounds;
        const gwIdx = outbounds.findIndex((g: any) => g.tag === "ExitGateway");
        if (gwIdx === -1) return;

        for (const group of groups) {
            const servers = await getServersByGroup(group.identifier);
            if (!servers.length) continue;

            // Find existing outbound tags for these servers (already added
            // by mergeManualServersConfig). Match by tag pattern first, then server:port.
            const tags: string[] = [];
            for (const s of servers) {
                const ptype = s.proxy_type || "ss";
                const tagPrefix = `${ptype}-${s.identifier.slice(0, 8)}`;
                // Try exact tag match first (more reliable)
                let existing = outbounds.find((o: any) => o.tag === tagPrefix);
                // Fall back to server:port match
                if (!existing) {
                    existing = outbounds.find((o: any) =>
                        o.server === s.server_address && o.server_port === s.server_port);
                }
                if (existing) {
                    tags.push(existing.tag);
                    console.log(`[mergeProxyGroups] matched server ${s.server_address}:${s.server_port} → tag ${existing.tag} (type=${existing.type})`);
                } else {
                    console.warn(`[mergeProxyGroups] NO match for server ${s.server_address}:${s.server_port} (tagPrefix=${tagPrefix})`);
                }
            }

            if (!tags.length) {
                console.warn(`[mergeProxyGroups] group=${group.name} has no matching outbounds, skipping`);
                continue;
            }

            console.log(`[mergeProxyGroups] group=${group.name} type=${group.group_type} servers=${servers.length} tags=[${tags.join(",")}]`);

            const prefix = `gp-${group.identifier.slice(0, 6)}`;
            // Remove any previous entries from this group to avoid duplicates
            outbounds[gwIdx].outbounds = outbounds[gwIdx].outbounds.filter(
                (t: string) => !t.startsWith(prefix)
            );

            if (group.group_type === "chain") {
                // Chain: create linked outbounds referencing existing ones
                // Build chain from last to first, each with detour to next
                let prevTag = "";
                const chainTags: string[] = [];
                for (let i = tags.length - 1; i >= 0; i--) {
                    const chainTag = `${prefix}-c${i}`;
                    const existing = outbounds.find((o: any) => o.tag === tags[i]);
                    if (!existing) continue;
                    // Deep-clone existing outbound config and add detour
                    const o: any = JSON.parse(JSON.stringify(existing));
                    o.tag = chainTag;
                    if (prevTag) { o.detour = prevTag; } else { delete o.detour; }
                    outbounds.push(o);
                    chainTags.unshift(chainTag);
                    prevTag = chainTag;
                }
                console.log(`[mergeProxyGroups] chain: entry=${chainTags[0]} order=[${chainTags.join("→")}] detours=[${chainTags.map(t => { const o = outbounds.find((x: any) => x.tag === t); return o?.detour || "none"; }).join(",")}]`);
                if (chainTags.length > 0) {
                    outbounds[gwIdx].outbounds.push(chainTags[0]);
                    if (group.is_active) {
                        const idx = outbounds[gwIdx].outbounds.indexOf(chainTags[0]);
                        if (idx > 0) { outbounds[gwIdx].outbounds.splice(idx, 1); outbounds[gwIdx].outbounds.unshift(chainTags[0]); }
                    }
                }
            } else {
                // fixed/auto/random: wrap in selector or urltest using existing tags
                if (group.group_type === "auto") {
                    const autoTag = `${prefix}-auto`;
                    outbounds.push({ tag: autoTag, type: "urltest", url: "https://www.google.com/generate_204", interval: "5m", outbounds: [...tags] });
                    outbounds[gwIdx].outbounds.push(autoTag);
                    if (group.is_active) outbounds[gwIdx].outbounds.unshift(autoTag);
                } else {
                    const selTag = `${prefix}-sel`;
                    outbounds.push({ tag: selTag, type: "selector", outbounds: [...tags], default: tags[0] });
                    outbounds[gwIdx].outbounds.push(selTag);
                    if (group.is_active) outbounds[gwIdx].outbounds.unshift(selTag);
                }
            }
        }

        // Deduplicate ExitGateway outbounds
        const seen = new Set<string>();
        outbounds[gwIdx].outbounds = outbounds[gwIdx].outbounds.filter((t: string) => {
            if (seen.has(t)) return false;
            seen.add(t);
            return true;
        });

        // If any group is active, move it to the front (default)
        for (const group of groups) {
            if (!group.is_active) continue;
            const servers = await getServersByGroup(group.identifier);
            if (!servers.length) continue;
            const prefix = `gp-${group.identifier.slice(0, 6)}`;
            const groupTag = outbounds[gwIdx].outbounds.find((t: string) => t.startsWith(prefix));
            if (groupTag) {
                const idx = outbounds[gwIdx].outbounds.indexOf(groupTag);
                if (idx > 0) {
                    outbounds[gwIdx].outbounds.splice(idx, 1);
                    outbounds[gwIdx].outbounds.unshift(groupTag);
                }
            }
        }

        await writeConfigFile("config.json", new TextEncoder().encode(JSON.stringify(newConfig)));
    } catch (e) {
        console.warn("[mergeProxyGroups] skipped — error:", e);
    }
}
