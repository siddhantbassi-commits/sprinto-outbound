import { evalDkim, evalDmarc, evalMx, evalSpf, senderDomain, type Check } from "./checks";

export interface Resolver {
  txt(name: string): Promise<string[][]>;
  mx(name: string): Promise<{ exchange: string }[]>;
}

const PERSONAL = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"];

/** The four DNS checks for a sending address. A personal or missing address has no domain of its own to look up. */
export async function dnsChecks(from: string | null, r: Resolver, selector = "google"): Promise<Check[]> {
  const d = senderDomain(from);
  if (!d || PERSONAL.includes(d)) return [];
  const [spf, dmarc, dkim, mx] = await Promise.all([r.txt(d), r.txt(`_dmarc.${d}`), r.txt(`${selector}._domainkey.${d}`), r.mx(d)]);
  return [evalSpf(spf, d), evalDkim(dkim, d, selector), evalDmarc(dmarc, d), evalMx(mx, d)];
}
