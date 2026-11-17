/**
 * robots.txt, read the way RFC 9309 says: pick the group for our agent name (else "*"), the longest matching rule wins,
 * and Allow beats Disallow on a tie. A missing file (4xx) means everything is allowed; a server error or an unreachable
 * file means nothing is, so a flaky server never gets crawled by accident.
 */

interface Rule {
  allow: boolean;
  pattern: string;
}
interface Group {
  agents: string[];
  rules: Rule[];
}

export interface RobotsFile {
  groups: Group[];
  /** True when the file could not be read for a reason that should stop us. */
  disallowAll: boolean;
}

const MAX_BYTES = 500 * 1024;

export const ALLOW_ALL: RobotsFile = { groups: [], disallowAll: false };
export const DISALLOW_ALL: RobotsFile = { groups: [], disallowAll: true };

export function parseRobots(text: string): RobotsFile {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collecting = false;
  for (const rawLine of text.slice(0, MAX_BYTES).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === "user-agent") {
      if (!collecting || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collecting = true;
    } else if (field === "allow" || field === "disallow") {
      collecting = false;
      if (current) current.rules.push({ allow: field === "allow", pattern: value });
    } else {
      collecting = false;
    }
  }
  return { groups, disallowAll: false };
}

/** What to do with the file's HTTP response. */
export function robotsFromResponse(status: number, body: string): RobotsFile {
  if (status >= 200 && status < 300) return parseRobots(body);
  if (status >= 400 && status < 500) return ALLOW_ALL;
  return DISALLOW_ALL;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** `agent` is our product token, such as "SprintoOutboundBot"; `pathAndQuery` is the request's path plus query. */
export function robotsAllows(file: RobotsFile, agent: string, pathAndQuery: string): boolean {
  if (file.disallowAll) return false;
  const token = agent.toLowerCase();
  const specific = file.groups.filter((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const groups = specific.length > 0 ? specific : file.groups.filter((g) => g.agents.includes("*"));
  let best: { len: number; allow: boolean } | null = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (rule.pattern === "") continue; // "Disallow:" with nothing after it allows everything
    if (!toRegex(rule.pattern).test(pathAndQuery)) continue;
    const len = rule.pattern.length;
    if (!best || len > best.len || (len === best.len && rule.allow && !best.allow)) best = { len, allow: rule.allow };
  }
  return best ? best.allow : true;
}
