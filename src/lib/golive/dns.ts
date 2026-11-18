import "server-only";
import { promises as dns } from "node:dns";
import type { Resolver } from "./dns-core";

export { dnsChecks } from "./dns-core";

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T> => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** The system resolver, with a short timeout. A name that does not exist or does not answer is an empty answer, not an error. */
export const systemResolver: Resolver = {
  txt: (n) => withTimeout(dns.resolveTxt(n), 4000).catch(() => []),
  mx: (n) => withTimeout(dns.resolveMx(n), 4000).catch(() => []),
};

/** A stand-in for demo mode: a domain that is set up well except for DMARC, which is still only monitoring. */
export const demoResolver: Resolver = {
  txt: async (n) => (n.startsWith("_dmarc.") ? [["v=DMARC1; p=none; rua=mailto:dmarc@example.com"]] : n.startsWith("google._domainkey.") ? [["v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAdemo"]] : [["v=spf1 include:_spf.google.com ~all"]]),
  mx: async () => [{ exchange: "aspmx.l.google.com" }],
};
