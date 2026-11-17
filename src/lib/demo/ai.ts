import { emptyFacts } from "@/lib/icp/types";
import type { AiClient, JsonRequest, JsonResponse, ToolRequest, ToolTurn } from "@/lib/ai/types";
import { DEMO_BY_DOMAIN, type DemoCompany } from "./companies";

/**
 * A pretend model for demo mode. It reads the same prompts the real model would and answers from the sample
 * companies' own sentences, so everything downstream (the quote check, the score, the lint) runs for real.
 * It is not intelligent and says nothing it was not scripted to say.
 */

const USAGE = { promptTokens: 2400, outputTokens: 420, totalTokens: 2820 };

function domainIn(prompt: string): DemoCompany | null {
  const m = /\| \w+ page: https?:\/\/([a-z0-9.-]+)\//i.exec(prompt);
  return m ? (DEMO_BY_DOMAIN.get((m[1] as string).replace(/^www\./, "")) ?? null) : null;
}

type F = { value: unknown; confidence: "high" | "medium" | "low"; quotes: string[] };
const f = (value: unknown, quotes: string[] = [], confidence: F["confidence"] = "high"): F => ({ value, confidence, quotes });

export function extractionFor(c: DemoCompany): Record<string, F> {
  const out = structuredClone(emptyFacts()) as unknown as Record<string, F>;
  const s = c.s;
  const q = (x: string | undefined) => (x ? [x] : []);
  out.product = f(c.kind === "consumer" ? "consumer" : "saas", q(s.product));
  out.audience = f(c.kind === "consumer" ? "consumer" : "business", q(s.product));
  if (c.kind === "thin") return { ...out, product: f(null), audience: f(null) };
  if (s.data) out.customerData = f("stated", q(s.data));
  if (c.band && s.size) out.headcount = f(c.band, q(s.size), "medium");
  if (s.plan) {
    out.enterprisePlan = f(true, q(s.plan));
    out.enterpriseSecurity = f(true, q(s.plan));
  }
  if (s.logos) out.enterpriseLogos = f(true, q(s.logos));
  if (c.compliance && s.cert) out.compliance = f(c.compliance, q(s.cert));
  else if (c.compliance === "none_visible") out.compliance = f("none_visible");
  if (c.kind !== "competitor") out.complianceVendor = f("none");
  if (s.eu) out.sellsEu = f(true, q(s.eu));
  if (s.health) out.healthData = f(true, q(s.health));
  if (s.payments) out.payments = f(true, q(s.payments));
  if (c.hiring === "security_role" && s.hiring) out.securityHiring = f("security_role", q(s.hiring));
  else if (c.hiring === "none") out.securityHiring = f("none");
  if (s.funding) out.recentLaunchOrFunding = f(true, q(s.funding), "medium");
  if (s.friction) out.securityFriction = f(true, q(s.friction), "medium");
  return out;
}

export function demoAi(): AiClient {
  return {
    async generateJson(req: JsonRequest): Promise<JsonResponse> {
      const base = { usage: USAGE, model: "demo-model", latencyMs: 1 };
      if (req.purpose === "extract") {
        const c = domainIn(req.user);
        return { ...base, data: c ? extractionFor(c) : emptyFacts() };
      }
      if (req.purpose === "pains") {
        const blocks = req.user.split(/^(?=P\d\. )/m).filter((b) => /^P\d\. /.test(b)).slice(0, 2);
        return { ...base, data: { picks: blocks.map((b) => ({ painId: b.slice(0, 2), reason: "This fits the stage the company is at and what its pages say.", evidenceIds: [...b.matchAll(/^ {2}- (\w+): /gm)].map((m) => m[1]) })) } };
      }
      const quote = /H1: <<<DATA [0-9a-f]+ \| quote>>>\n([\s\S]*?)\n<<<END/.exec(req.user)?.[1] ?? "";
      const company = /^Company: (.+?) \(/m.exec(req.user)?.[1] ?? "your company";
      return {
        ...base,
        data: {
          subject: `Security reviews at ${company}`,
          hookId: "H1",
          message: `I noticed this on ${company}'s site: "${quote}" Teams at that stage often hear larger prospects ask for a SOC 2 report they cannot yet hand over, while engineers get pulled off product work to gather audit evidence. Sprinto automates SOC 2, ISO 27001 and GDPR compliance for SaaS companies. Worth 15 minutes next week to see how teams in your spot get audit-ready?`,
        },
      };
    },
    async generateTurn(req: ToolRequest): Promise<ToolTurn> {
      // The pretend model never needs more pages: it stops, and the code scores what it has.
      const calls = [{ name: "stop", args: { reason: "Demo model: nothing more to fetch." } }];
      void req;
      return { text: "", calls, finish: "tool_calls", content: { role: "model", parts: calls.map((c) => ({ functionCall: c })) }, usage: USAGE, model: "demo-model", latencyMs: 1 };
    },
  };
}
