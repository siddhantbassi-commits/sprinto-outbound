import type { FetchDeps, Transport, TransportRequest } from "@/lib/scrape/fetch";
import { botUserAgent } from "@/lib/scrape/site";

export interface Route {
  status?: number;
  body?: string;
  type?: string;
  headers?: Record<string, string>;
  delayMs?: number;
  error?: Error;
}

export const page = (body: string): Route => ({ status: 200, type: "text/html; charset=utf-8", body });
export const redirect = (to: string, status = 301): Route => ({ status, headers: { location: to }, body: "" });

/**
 * A scripted web: URL to response, with DNS answers and a record of every request made.
 * Nothing in the suite touches the network; this is what stands in for it.
 */
export function fakeWeb(routes: Record<string, Route | string>, opts: { dns?: Record<string, string[]> } = {}) {
  const calls: TransportRequest[] = [];
  const stats = { inFlight: 0, maxInFlight: 0 };
  const transport: Transport = async (req) => {
    calls.push(req);
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    try {
      const entry = routes[req.url.href];
      const route: Route = typeof entry === "string" ? page(entry) : (entry ?? { status: 404, type: "text/html", body: "not found" });
      if (route.delayMs) await new Promise((r) => setTimeout(r, route.delayMs));
      if (route.error) throw route.error;
      const body = Buffer.from(route.body ?? "", "utf8");
      return {
        status: route.status ?? 200,
        headers: { "content-type": route.type ?? "text/html", ...(route.headers ?? {}) },
        body,
        truncated: false,
      };
    } finally {
      stats.inFlight -= 1;
    }
  };
  const resolve = async (host: string) => opts.dns?.[host] ?? ["93.184.216.34"];
  const deps: FetchDeps = { resolve, transport, userAgent: botUserAgent("test@example.com") };
  return { deps, calls, stats, urls: () => calls.map((c) => c.url.href) };
}
