import { BlockList, isIP } from "node:net";

/**
 * The scraper's front door. Every domain a person types, every redirect and every page the agent asks for goes
 * through here first, so a hostile or mistaken input can never make the server fetch something on its own network.
 * Pure functions, with DNS injected, so the whole table of bad cases is tested offline.
 */

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

const v4 = new BlockList();
for (const cidr of [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24",
  "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4",
]) {
  const [address, prefix] = cidr.split("/") as [string, string];
  v4.addSubnet(address, Number(prefix), "ipv4");
}
const v6 = new BlockList();
v6.addAddress("::", "ipv6");
v6.addAddress("::1", "ipv6");
// 2002::/16 (6to4) and 2001::/32 (Teredo) tunnel IPv4 traffic and can hide a private IPv4 address inside an IPv6 one.
for (const cidr of ["fc00::/7", "fe80::/10", "ff00::/8", "2001:db8::/32", "64:ff9b::/96", "100::/64", "2002::/16", "2001::/32"]) {
  const [address, prefix] = cidr.split("/") as [string, string];
  v6.addSubnet(address, Number(prefix), "ipv6");
}

/** True for anything that is not a plain, public, routable address. Unknown input counts as blocked. */
export function isBlockedIp(raw: string): boolean {
  const ip = raw.split("%")[0] ?? "";
  const kind = isIP(ip);
  if (kind === 4) return v4.check(ip, "ipv4");
  if (kind === 6) {
    const mapped = ip.toLowerCase().match(/^(?:::ffff:|0:0:0:0:0:ffff:)(.+)$/);
    if (mapped) {
      const rest = mapped[1] as string;
      if (isIP(rest) === 4) return isBlockedIp(rest);
      const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1] as string, 16);
        const lo = parseInt(hex[2] as string, 16);
        return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true;
    }
    return v6.check(ip, "ipv6");
  }
  return true;
}

const RESERVED_TLDS = new Set([
  "localhost", "local", "internal", "lan", "home", "corp", "intranet", "invalid", "test", "example", "onion", "arpa",
]);
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export type DomainResult = { ok: true; domain: string } | { ok: false; reason: string };

/** Turns whatever was typed or pasted into a bare public hostname, or says exactly why it cannot. */
export function normaliseDomain(input: string): DomainResult {
  let s = input.trim().toLowerCase();
  if (!s) return { ok: false, reason: "Empty" };
  if (/\s/.test(s)) return { ok: false, reason: "Contains spaces" };
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\//);
  if (scheme) {
    if (scheme[1] !== "http" && scheme[1] !== "https") return { ok: false, reason: `Only http and https are allowed, not ${scheme[1]}` };
    s = s.slice(scheme[0].length);
  }
  let host = s.split(/[/?#]/)[0] ?? "";
  if (host.includes("@")) host = host.split("@").pop() ?? "";
  if (host.startsWith("[")) return { ok: false, reason: "An IP address is not a company domain" };
  host = host.replace(/:\d+$/, "").replace(/\.+$/, "");
  let ascii: string;
  try {
    ascii = new URL(`http://${host}`).hostname;
  } catch {
    return { ok: false, reason: "Not a valid hostname" };
  }
  if (isIP(ascii) || isIP(ascii.replace(/^\[|\]$/g, ""))) return { ok: false, reason: "An IP address is not a company domain" };
  if (!ascii.includes(".")) return { ok: false, reason: "A company domain needs a dot, like acme.com" };
  if (ascii.length > 253) return { ok: false, reason: "Too long" };
  const labels = ascii.split(".");
  if (!labels.every((l) => LABEL.test(l))) return { ok: false, reason: "Not a valid hostname" };
  const tld = labels[labels.length - 1] as string;
  if (RESERVED_TLDS.has(tld)) return { ok: false, reason: `.${tld} is not a public domain` };
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(tld)) return { ok: false, reason: "Not a valid hostname" };
  return { ok: true, domain: ascii.replace(/^www\./, "") };
}

const TWO_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.in", "net.in", "org.in", "co.nz", "com.br",
  "co.jp", "co.za", "com.sg", "com.hk", "com.mx", "com.tr", "co.il",
]);

/** The part of a hostname that identifies the owner (acme.co.uk, not www.acme.co.uk). A small built-in list of suffixes. */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const last2 = labels.slice(-2).join(".");
  return TWO_PART_SUFFIXES.has(last2) ? labels.slice(-3).join(".") : last2;
}

export const sameSite = (a: string, b: string) => registrableDomain(a) === registrableDomain(b);

export type Resolver = (host: string) => Promise<string[]>;

/** Resolves a hostname and refuses unless every address is public. Returns the addresses so the caller connects to these, not to a second lookup. */
export async function assertPublicHost(host: string, resolve: Resolver): Promise<string[]> {
  const addresses = await resolve(host);
  if (addresses.length === 0) throw new GuardError(`${host} did not resolve`);
  for (const address of addresses) {
    if (isBlockedIp(address)) throw new GuardError(`${host} points to a private or reserved address`);
  }
  return addresses;
}

/** A redirect is followed only to http(s) on the same registered domain, and the new host must also be public. */
export async function checkRedirect(fromHost: string, location: string, base: string, resolve: Resolver): Promise<URL> {
  let target: URL;
  try {
    target = new URL(location, base);
  } catch {
    throw new GuardError("Redirect to an invalid address");
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") throw new GuardError(`Redirect to ${target.protocol} refused`);
  if (!sameSite(fromHost, target.hostname)) throw new GuardError(`Redirect left the company's domain (${target.hostname})`);
  await assertPublicHost(target.hostname, resolve);
  return target;
}
