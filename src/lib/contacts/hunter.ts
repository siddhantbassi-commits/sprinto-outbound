import { normaliseDomain } from "@/lib/scrape/url-guard";
import type { Candidate } from "./rank";

/**
 * Hunter.io over plain REST. The key goes in a header, never in the URL, and no error carries Hunter's text or the key.
 * Response shapes follow Hunter's published OpenAPI spec (https://hunter.io/openapi.json): `data.emails[]` for a domain
 * search and `data.requests.credits|searches` for the account.
 */

const BASE = "https://api.hunter.io/v2";

export type HunterErrorCode = "auth" | "quota" | "rate_limited" | "bad_request" | "timeout" | "api_error" | "bad_response" | "not_configured" | "no_discover";

const MESSAGES: Record<HunterErrorCode, string> = {
  auth: "Hunter refused the API key. Ask an admin to check it.",
  quota: "Hunter says the monthly credits are used up.",
  rate_limited: "Hunter is rate limiting requests. Try again in a minute.",
  bad_request: "Hunter rejected the request as invalid.",
  timeout: "Hunter took too long to answer.",
  api_error: "Something went wrong reaching Hunter.",
  bad_response: "Hunter's answer was not in the shape we expect.",
  not_configured: "No Hunter API key is set.",
  no_discover: "This Hunter plan does not include Discover, so companies cannot be found automatically. Paste a list of domains instead.",
};

export class HunterError extends Error {
  constructor(readonly code: HunterErrorCode) {
    super(MESSAGES[code]);
    this.name = "HunterError";
  }
}

export interface HunterAccount {
  /** Credits (or searches, on plans without a credit pool) left this period. */
  remaining: number;
  used: number;
  available: number;
  unit: "credits" | "searches";
  resetDate: string | null;
}

export interface DomainSearchOptions {
  /** Hunter's plan may cap this (the free plan allows 10). */
  limit?: number;
  seniority?: string;
  type?: "personal" | "generic";
}

export interface DomainSearchResult {
  candidates: Candidate[];
  /** What Hunter says this call cost, from the X-Credits-Used header. */
  creditsUsed: number;
  /** How many matching addresses Hunter holds, which may exceed what came back. */
  total: number;
}

export interface DiscoverCompany {
  /** Set by the caller that asked for one size band at a time; Hunter does not return it. */
  band?: string;
  domain: string;
  name: string;
  /** How many addresses Hunter holds for the company, which is a fair sign it will be able to name a contact. */
  emailsTotal: number;
  emailsPersonal: number;
}

export interface DiscoverResult {
  companies: DiscoverCompany[];
  /** How many companies matched in all, of which only the first page came back. */
  total: number;
}

export type VerifyStatus = "valid" | "invalid" | "accept_all" | "webmail" | "disposable" | "unknown";

export interface VerifyResult {
  status: VerifyStatus;
  /** Hunter's own 0 to 100 confidence that the address will accept mail. */
  score: number | null;
}

export interface HunterClient {
  account(): Promise<HunterAccount>;
  /** Checks one address with Hunter's verifier. This one costs credit, so it is only ever called on purpose. Absent on stand-ins that cannot verify. */
  verify?(email: string): Promise<VerifyResult>;
  domainSearch(domain: string, opts?: DomainSearchOptions): Promise<DomainSearchResult>;
  /** Finds companies by filters. Hunter says this call is free. Absent on stand-ins that cannot discover. */
  discover?(filters: Record<string, unknown>, limit?: number): Promise<DiscoverResult>;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function readAccount(body: unknown): HunterAccount {
  const requests = obj(obj(obj(body)?.data)?.requests);
  const pool = obj(requests?.credits) ?? obj(requests?.searches);
  if (!requests || !pool) throw new HunterError("bad_response");
  const unit = obj(requests.credits) ? "credits" : "searches";
  const used = num(pool.used) ?? 0;
  const available = num(pool.available) ?? 0;
  const remaining = num(pool.remaining) ?? Math.max(0, available - used);
  return { remaining: Math.max(0, remaining), used, available, unit, resetDate: str(obj(obj(body)?.data)?.reset_date) };
}

const VERIFICATION = new Set(["valid", "accept_all", "unknown", "invalid", "disposable", "webmail"]);
const SENIORITY = new Set(["executive", "senior", "junior"]);

/** Maps one Hunter email entry to the ranker's candidate. An entry with no address is dropped. */
export function toCandidate(entry: unknown): Candidate | null {
  const e = obj(entry);
  const email = str(e?.value);
  if (!e || !email) return null;
  const type = e.type === "personal" || e.type === "generic" ? e.type : null;
  const seniority = typeof e.seniority === "string" && SENIORITY.has(e.seniority) ? (e.seniority as Candidate["seniority"]) : null;
  const status = str(obj(e.verification)?.status);
  const confidence = num(e.confidence);
  return {
    source: "hunter",
    firstName: str(e.first_name),
    lastName: str(e.last_name),
    position: str(e.position),
    email,
    type,
    seniority,
    department: str(e.department),
    confidence: confidence === null ? null : Math.min(100, Math.max(0, confidence)),
    verification: status === null ? null : ((VERIFICATION.has(status) ? status : "unknown") as Candidate["verification"]),
  };
}

export function readDomainSearch(body: unknown, creditsHeader: string | null): DomainSearchResult {
  const data = obj(obj(body)?.data);
  if (!data || !Array.isArray(data.emails)) throw new HunterError("bad_response");
  const candidates = data.emails.map(toCandidate).filter((c): c is Candidate => c !== null);
  const meta = obj(obj(body)?.meta);
  const header = creditsHeader !== null && /^[0-9]+(\.[0-9]+)?$/.test(creditsHeader) ? Number(creditsHeader) : null;
  // Hunter charges only for a call that returned something; if the header is missing, assume that rule.
  return { candidates, creditsUsed: header ?? (candidates.length > 0 ? 1 : 0), total: num(meta?.results) ?? candidates.length };
}

/** Hunter's companies from Discover: only a clean public domain and a plain name get through. */
export function readDiscover(body: unknown): DiscoverResult {
  const data = obj(body)?.data;
  if (!Array.isArray(data)) throw new HunterError("bad_response");
  const companies: DiscoverCompany[] = [];
  for (const raw of data) {
    const c = obj(raw);
    if (!c) continue;
    const domain = typeof c.domain === "string" ? normaliseDomain(c.domain) : null;
    if (!domain || !domain.ok) continue;
    const counts = obj(c.emails_count);
    companies.push({ domain: domain.domain, name: (str(c.organization) ?? domain.domain).slice(0, 120), emailsTotal: Math.max(0, num(counts?.total) ?? 0), emailsPersonal: Math.max(0, num(counts?.personal) ?? 0) });
  }
  return { companies, total: num(obj(obj(body)?.meta)?.results) ?? companies.length };
}

/** Hunter's verifier answer, kept to the six statuses it documents; anything else is "unknown", not trusted. */
export function readVerify(body: unknown): VerifyResult {
  const data = obj(obj(body)?.data);
  const status = str(data?.status);
  if (!data || status === null) throw new HunterError("bad_response");
  const score = num(data.score);
  return { status: (VERIFICATION.has(status) ? status : "unknown") as VerifyStatus, score: score === null ? null : Math.min(100, Math.max(0, Math.round(score))) };
}

function errorFor(status: number): HunterError {
  if (status === 401) return new HunterError("auth");
  if (status === 429) return new HunterError("quota");
  if (status === 403) return new HunterError("rate_limited");
  if (status === 400) return new HunterError("bad_request");
  return new HunterError("api_error");
}

export interface HunterOptions {
  apiKey: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export function createHunterClient({ apiKey, fetchFn = fetch, timeoutMs = 10_000 }: HunterOptions): HunterClient {
  const key = apiKey.replace(/\s+/g, "");
  if (!key) throw new HunterError("not_configured");

  async function get(path: string, params: Record<string, string> = {}): Promise<{ body: unknown; headers: Headers }> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetchFn(url, { headers: { "X-API-KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      throw e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? new HunterError("timeout") : new HunterError("api_error");
    }
    if (!res.ok) throw errorFor(res.status);
    const body: unknown = await res.json().catch(() => null);
    if (body === null) throw new HunterError("bad_response");
    return { body, headers: res.headers };
  }

  return {
    async account() {
      return readAccount((await get("/account")).body);
    },
    async discover(filters, limit = 100) {
      const size = Math.min(100, Math.max(1, Math.trunc(limit)));
      let res: Response;
      try {
        res = await fetchFn(`${BASE}/discover`, {
          method: "POST",
          headers: { "X-API-KEY": key, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ ...filters, limit: size }),
          signal: AbortSignal.timeout(Math.max(timeoutMs, 20_000)),
        });
      } catch (e) {
        throw e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? new HunterError("timeout") : new HunterError("api_error");
      }
      if (res.status === 403) {
        // A plan without Discover says so in its error id. Anything else on a 403 is Hunter limiting the caller.
        const text = await res.text().catch(() => "");
        throw new HunterError(/no_discover_access/.test(text) ? "no_discover" : "rate_limited");
      }
      if (!res.ok) throw errorFor(res.status);
      const body: unknown = await res.json().catch(() => null);
      if (body === null) throw new HunterError("bad_response");
      return readDiscover(body);
    },
    async verify(email) {
      // An address goes into the query string only if it is one plain address, so nothing can be added to the request.
      const clean = email.trim();
      if (clean.length > 254 || !/^[^\s@<>,;"()]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(clean)) throw new HunterError("bad_request");
      return readVerify((await get("/email-verifier", { email: clean })).body);
    },
    async domainSearch(domain, opts = {}) {
      // Only a clean public hostname may reach the query string, so a crafted "domain" cannot add parameters.
      const clean = normaliseDomain(domain);
      if (!clean.ok) throw new HunterError("bad_request");
      const limit = Math.min(100, Math.max(1, Math.trunc(opts.limit ?? 10)));
      const { body, headers } = await get("/domain-search", {
        domain: clean.domain,
        type: opts.type ?? "personal",
        seniority: opts.seniority ?? "senior,executive",
        limit: String(limit),
      });
      return readDomainSearch(body, headers.get("X-Credits-Used"));
    },
  };
}
