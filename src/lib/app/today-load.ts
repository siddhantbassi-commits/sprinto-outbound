import "server-only";
import { computeImpact } from "@/lib/app/impact";
import { loadKnown } from "@/lib/app/known";
import { listLeads, type Lead } from "@/lib/app/leads";
import { currentSettings, impactData, needsAttention, settingsPage, workerStatus, type ReviewItem } from "@/lib/app/queries";
import { buildReadiness, type Readiness } from "@/lib/app/readiness";
import { approvalQueue } from "@/lib/app/review";
import { hunterBalance, type AppSession } from "@/lib/app/runtime";
import { runStatuses, type RunStatus } from "@/lib/app/status";
import { followUpsDue, nextToCall, pipelineCounts, type FollowUpItem, type StageCount } from "@/lib/app/today";
import { loadDigests, loadSearch, type DigestRow } from "@/lib/digest/run";
import { factsFileProblems, type SprintoFactsFile } from "@/lib/pitch/sprinto-facts";
import { withSettings } from "@/lib/worker/pipeline";

const DAY = 86_400_000;

export interface TodayData {
  readiness: Readiness;
  testTo: string | null;
  lastTick: string | null;
  approvals: number;
  followUps: FollowUpItem[];
  decisions: ReviewItem[];
  nextCalls: Lead[];
  digest: { enabled: boolean; hasSearch: boolean; latest: DigestRow | null; fresh: DigestRow["found"] } | null;
  running: RunStatus[];
  pipeline: StageCount[];
  week: ReturnType<typeof computeImpact>;
  before: ReturnType<typeof computeImpact>;
}

/** Everything the Today screen needs, read once, as the signed-in person (so a viewer sees only what a viewer may). */
export async function loadToday(s: AppSession, now = Date.now()): Promise<TodayData> {
  const canDecide = s.user.role === "operator" || s.user.role === "admin";
  const [status, settings, page, hunter, data, needs, leads, approvals, running, search, digests] = await Promise.all([
    workerStatus(s.db),
    currentSettings(s.db),
    settingsPage(s.db),
    hunterBalance(),
    impactData(s.db),
    needsAttention(s.db),
    listLeads(s.db, s.user.role !== "viewer"),
    approvalQueue(s.db, canDecide),
    runStatuses(s.db, 5),
    loadSearch(s.db),
    loadDigests(s.db, 1),
  ]);
  const running_ = running.filter((r) => !r.finished && !r.paused);
  const file = page.file?.content as SprintoFactsFile | undefined;
  const signed = new Set(page.signoffs.map((x) => String(x.icp_version_id)));
  const icp = page.icp.find((v) => signed.has(v.id));
  const readiness = buildReadiness({
    mode: s.mode,
    testTo: settings?.test_to ?? null,
    icpSignedVersion: icp?.version ?? null,
    factsProblems: file && settings ? factsFileProblems(withSettings(file, settings)) : ["There is no facts file."],
    geminiSet: !!s.env.gemini,
    gmailSet: !!s.env.gmail,
    hunter: hunter && "error" in hunter && hunter.error ? { error: hunter.error } : hunter && typeof hunter.remaining === "number" ? { remaining: hunter.remaining } : null,
    lastTick: status.lastTick,
    now,
    waiting: running_.length,
    reserve: settings?.hunter_reserve ?? 3,
  });
  const assumptions = { manualMinutes: Number(settings?.minutes_saved_per_email ?? 20), reviewMinutesPerEmail: Number(settings?.review_minutes_per_email ?? 1.5), reviewMinutesPerDecision: Number(settings?.review_minutes_per_decision ?? 2) };
  const week = computeImpact({ ...data, range: { key: "7", label: "Last 7 days", from: now - 7 * DAY, to: now }, assumptions });
  const before = computeImpact({ ...data, range: { key: "7", label: "Previous 7 days", from: now - 14 * DAY, to: now - 7 * DAY - 1 }, assumptions });

  // What the latest digest suggested that nobody has acted on yet: not researched, suppressed or mailed since.
  let digest: TodayData["digest"] = null;
  if (search || digests[0]) {
    const known = await loadKnown(s.db, settings?.mail_cooldown_days ?? 30);
    const gone = new Set([...known.researched, ...known.suppressed, ...known.mailed]);
    const latest = digests[0] ?? null;
    digest = { enabled: search?.enabled ?? false, hasSearch: !!search, latest, fresh: (latest?.found ?? []).filter((c) => !gone.has(c.domain)) };
  }

  return {
    readiness,
    testTo: settings?.test_to ?? null,
    lastTick: status.lastTick,
    approvals: approvals.length,
    followUps: followUpsDue(leads, now),
    decisions: needs.filter((p) => p.lane !== "needs_more" && p.lane !== "no_contact"),
    nextCalls: nextToCall(leads),
    digest,
    running: running_,
    pipeline: pipelineCounts(leads),
    week,
    before,
  };
}
