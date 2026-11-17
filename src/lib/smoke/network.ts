import { htmlToText } from "@/lib/scrape/html-to-text";
import { safeFetch, type FetchDeps } from "@/lib/scrape/fetch";
import { assertPublicHost, GuardError, normaliseDomain } from "@/lib/scrape/url-guard";
import { pass, fail, safely, type Check } from "./report";

/** Does the scraper's real transport work from this machine, and does the guard hold against the real resolver? */
export async function networkChecks(deps: FetchDeps, url = "https://example.com/"): Promise<Check[]> {
  const out: Check[] = [];

  out.push(
    ...(await safely("network", "guard", "The web guard refuses internal addresses", async () => {
      const refused: string[] = [];
      for (const host of ["169.254.169.254", "127.0.0.1", "10.0.0.1", "::1"]) {
        try {
          await assertPublicHost(host, deps.resolve);
        } catch (e) {
          if (e instanceof GuardError) refused.push(host);
        }
      }
      const bad = normaliseDomain("localhost").ok || normaliseDomain("http://169.254.169.254/").ok;
      return refused.length === 4 && !bad ? pass("network", "guard", "The web guard refuses internal addresses", "the cloud-metadata address, loopback and private ranges are all refused") : fail("network", "guard", "The web guard refuses internal addresses", `only ${refused.length} of 4 internal addresses were refused`, "Do not run the scraper until this passes.");
    })),
  );

  out.push(
    ...(await safely("network", "fetch", "A real page can be fetched and read", async () => {
      const started = Date.now();
      const res = await safeFetch(url, deps, { accept: "html" });
      const page = htmlToText(res.body, res.url);
      const ms = Date.now() - started;
      if (res.status !== 200) return fail("network", "fetch", "A real page can be fetched and read", `${url} answered HTTP ${res.status}`);
      return pass("network", "fetch", "A real page can be fetched and read", `${new URL(res.url).host}: ${res.bytes} bytes in ${ms} ms, ${res.redirects} redirects, title "${page.title || "(none)"}", ${page.text.length} characters of text`);
    })),
  );

  out.push(
    ...(await safely("network", "robots", "robots.txt can be read", async () => {
      const res = await safeFetch(new URL("/robots.txt", url).href, deps, { accept: "text", timeoutMs: 5000 });
      return pass("network", "robots", "robots.txt can be read", `HTTP ${res.status}, ${res.bytes} bytes (a missing file is fine: it means everything is allowed)`);
    })),
  );
  return out;
}
