import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { assertPublicHost, checkRedirect, GuardError, type Resolver } from "./url-guard";

/**
 * Every outbound page request goes through safeFetch. The address it connects to is the one the guard just checked
 * (not a second DNS lookup), redirects are re-checked hop by hop, and size, time and content type are capped.
 * The transport is injected, so the whole thing is tested offline with a scripted one.
 */

export class FetchError extends Error {
  constructor(
    readonly code: "timeout" | "network" | "too_many_redirects" | "wrong_type" | "bad_url",
    message: string,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

export interface TransportRequest {
  url: URL;
  /** The already-checked address to connect to. The hostname is still used for TLS and the Host header. */
  address: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
}
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
}
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export interface FetchDeps {
  resolve: Resolver;
  transport: Transport;
  /** Sent as User-Agent. Names the bot and gives a contact address. */
  userAgent: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** "html" for pages; "text" for robots.txt and sitemaps. */
  accept?: "html" | "text";
}

export interface FetchResult {
  /** Where the response actually came from, after redirects. */
  url: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  truncated: boolean;
  redirects: number;
}

export const DEFAULTS = { timeoutMs: 8_000, maxBytes: 1_500_000, maxRedirects: 4 } as const;

/** The system resolver, every address returned (so one private address among public ones still blocks the host). */
export const systemResolver: Resolver = async (host) => {
  try {
    return (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);
  } catch {
    return []; // assertPublicHost turns an empty answer into "did not resolve"
  }
};

/** The real transport: Node's http(s) client with the lookup pinned to the address the guard approved. */
export const nodeTransport: Transport = ({ url, address, headers, timeoutMs, maxBytes }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const family = address.includes(":") ? 6 : 4;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: { ...headers, Host: url.host, "Accept-Encoding": "identity" },
        // Connect to the checked address, whatever the name resolves to now. This closes the DNS-rebinding gap.
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
          if (opts?.all) cb(null, [{ address, family }]);
          else cb(null, address, family);
        }) as never,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            const keep = chunk.length - (size - maxBytes);
            if (keep > 0) chunks.push(chunk.subarray(0, keep));
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () =>
          done(() => {
            const out: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
            resolve({ status: res.statusCode ?? 0, headers: out, body: Buffer.concat(chunks), truncated });
          });
        res.on("end", finish);
        res.on("close", () => (truncated ? finish() : done(() => reject(new FetchError("network", "Connection closed early")))));
        res.on("error", () => (truncated ? finish() : done(() => reject(new FetchError("network", "Connection error")))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(() => reject(new FetchError("timeout", `No full response within ${timeoutMs} ms`)));
    }, timeoutMs);
    req.on("error", () => done(() => reject(new FetchError("network", "Could not connect"))));
    req.end();
  });

/** Only the standard web ports, no embedded logins: a model-chosen or redirect-supplied URL cannot probe other services. */
function parseTarget(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchError("bad_url", "Not a valid address");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new GuardError(`Only http and https are allowed, not ${u.protocol}`);
  if (u.username || u.password) throw new GuardError("Addresses with a login in them are refused");
  if (u.port !== "" && u.port !== "80" && u.port !== "443") throw new GuardError(`Port ${u.port} is not allowed`);
  return u;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

const looksLikeHtml = (type: string, body: Buffer) => /text\/html|application\/xhtml/i.test(type) || (type === "" && /^\s*<(!doctype|html|head|body)/i.test(body.subarray(0, 200).toString("utf8")));
const looksLikeText = (type: string) => type === "" || /^text\/|xml|json/i.test(type);

export async function safeFetch(rawUrl: string, deps: FetchDeps, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = opts.maxRedirects ?? DEFAULTS.maxRedirects;
  const accept = opts.accept ?? "html";
  const deadline = Date.now() + timeoutMs;

  let url = parseTarget(rawUrl);
  const originHost = url.hostname;
  for (let hop = 0; ; hop += 1) {
    const addresses = await assertPublicHost(url.hostname, deps.resolve);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FetchError("timeout", `No full response within ${timeoutMs} ms`);
    const res = await deps.transport({
      url,
      address: addresses[0] as string,
      headers: {
        "User-Agent": deps.userAgent,
        Accept: accept === "html" ? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" : "text/plain,text/xml,application/xml;q=0.9,*/*;q=0.1",
      },
      timeoutMs: remaining,
      maxBytes,
    });

    const location = res.headers.location;
    if (REDIRECTS.has(res.status) && location) {
      if (hop >= maxRedirects) throw new FetchError("too_many_redirects", `More than ${maxRedirects} redirects`);
      const next = await checkRedirect(originHost, location, url.href, deps.resolve);
      url = parseTarget(next.href);
      continue;
    }

    const contentType = (res.headers["content-type"] ?? "").toLowerCase();
    const okStatus = res.status >= 200 && res.status < 300;
    if (okStatus) {
      const fine = accept === "html" ? looksLikeHtml(contentType, res.body) : looksLikeText(contentType);
      if (!fine) throw new FetchError("wrong_type", `Expected ${accept === "html" ? "a web page" : "text"} but got ${contentType || "an unknown type"}`);
    }
    return {
      url: url.href,
      status: res.status,
      contentType,
      body: okStatus || accept === "text" ? decode(res.body, contentType) : "",
      bytes: res.body.length,
      truncated: res.truncated,
      redirects: hop,
    };
  }
}
