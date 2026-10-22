import net from "node:net";

/**
 * Hosts a teammate's http_request must never reach: this laptop and the networks
 * it sits on. The open app's API, Chrome's debugging port and the owner's router all
 * answer there without any authentication.
 */

function ipv4Private(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || // 0.0.0.0/8 ("this host")
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) // 192.168/16
  );
}

/** Expands the IPv4 tail of an IPv4-mapped IPv6 address (`::ffff:7f00:1` → `127.0.0.1`). */
function mappedIpv4(ip: string): string | null {
  const m = /^(?:0*:)*ffff:(.+)$/i.exec(ip);
  if (!m) return null;
  const tail = m[1];
  if (net.isIPv4(tail)) return tail;
  const groups = tail.split(":");
  if (groups.length !== 2 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const [hi, lo] = groups.map((g) => parseInt(g, 16));
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}

function ipv6Private(ip: string) {
  const mapped = mappedIpv4(ip);
  if (mapped) return ipv4Private(mapped);
  const first = ip.split(":")[0].toLowerCase();
  if (/^0*$/.test(first) && /^[0:]*1?$/.test(ip)) return true; // :: and ::1
  const n = parseInt(first || "0", 16);
  return (n & 0xffc0) === 0xfe80 || (n & 0xfe00) === 0xfc00; // fe80::/10, fc00::/7
}

/** True for localhost names, loopback, link-local and private addresses. */
export function isPrivateHost(hostname: string) {
  let h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (!h || h === "localhost" || h.endsWith(".localhost")) return true;
  const kind = net.isIP(h);
  if (kind === 4) return ipv4Private(h);
  if (kind === 6) return ipv6Private(h);
  return false;
}
