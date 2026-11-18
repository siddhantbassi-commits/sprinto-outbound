"use client";
import Link from "next/link";
import { EmailFrame } from "@/components/email-frame";
import { renderEmailHtml } from "@/lib/email/render";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import { Banner, Pill, Ring } from "@/components/ui";
import { editStats, wordDiff } from "@/lib/app/editdiff";
import type { ApprovalItem } from "@/lib/app/review";
import { approveAllClean, approveDraft, rejectDraft, type DecisionResult } from "./actions";

const REASONS: [string, string][] = [["weak_hook", "The opening is weak"], ["wrong_person", "Wrong person"], ["not_fit", "Not a fit after all"], ["timing", "Not the right time"], ["other", "Other"]];

export function ReviewDesk({ items, canDecide, sender, testTo }: { items: ApprovalItem[]; canDecide: boolean; sender: string; testTo: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [list, setList] = useState(items);
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [category, setCategory] = useState("weak_hook");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<DecisionResult["failed"]>(undefined);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // The server's list wins whenever it changes (after a refresh), so the desk never shows a draft someone else decided.
  useEffect(() => setList(items), [items]);
  const cur = list[Math.min(at, list.length - 1)];
  const cleanCount = list.filter((i) => i.clean).length;

  const reset = useCallback(() => {
    setEditing(false);
    setRejecting(false);
    setFailed(undefined);
    setNote("");
    setWhy("");
    setShowChecks(false);
  }, []);
  useEffect(() => { reset(); setSubject(cur?.email.subject ?? ""); setBody(cur?.email.body ?? ""); }, [cur?.email.id, reset]); // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => (cur && editing ? editStats(`${cur.email.subject}\n${cur.email.body}`, `${subject}\n${body}`) : null), [cur, editing, subject, body]);
  const diff = useMemo(() => (cur && editing && stats && stats.ratio > 0 ? wordDiff(cur.email.body, body) : null), [cur, editing, stats, body]);

  const removeCurrent = useCallback((id: string) => {
    setLeaving(id);
    setTimeout(() => {
      setList((xs) => xs.filter((x) => x.email.id !== id));
      setLeaving(null);
      startTransition(() => router.refresh());
    }, 340);
  }, [router]);

  const approve = useCallback(async () => {
    if (!cur || busy || !canDecide) return;
    setBusy(true);
    setFailed(undefined);
    const r = await approveDraft(cur.email.id, subject, body, note);
    setBusy(false);
    if (!r.ok) { setFailed(r.failed); toast(r.message, false); return; }
    toast(r.message, true);
    removeCurrent(cur.email.id);
  }, [cur, busy, canDecide, subject, body, note, removeCurrent]);

  const reject = useCallback(async () => {
    if (!cur || busy || !canDecide) return;
    setBusy(true);
    const r = await rejectDraft(cur.email.id, category, why);
    setBusy(false);
    toast(r.message, r.ok);
    if (r.ok) removeCurrent(cur.email.id);
  }, [cur, busy, canDecide, category, why, removeCurrent]);

  const bulk = useCallback(async () => {
    if (!confirmAll) { setConfirmAll(true); setTimeout(() => setConfirmAll(false), 5000); return; }
    setConfirmAll(false);
    setBusy(true);
    const r = await approveAllClean();
    setBusy(false);
    toast(r.message, r.ok);
    if (r.approved > 0) startTransition(() => router.refresh());
  }, [confirmAll, router]);

  // Keyboard: the fast path for someone with a list to get through.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest("input, textarea, select");
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && editing) { e.preventDefault(); void approve(); return; }
      if (e.key === "Escape" && (editing || rejecting)) { reset(); return; }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j") setAt((a) => Math.min(a + 1, list.length - 1));
      else if (e.key === "k") setAt((a) => Math.max(a - 1, 0));
      else if (e.key === "a" && canDecide) void approve();
      else if (e.key === "e" && canDecide) { setEditing(true); setRejecting(false); setTimeout(() => bodyRef.current?.focus(), 30); }
      else if (e.key === "r" && canDecide) { setRejecting(true); setEditing(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approve, canDecide, editing, rejecting, list.length, reset]);

  if (list.length === 0) return null;
  const passed = cur ? cur.email.checks.filter((c) => c.pass).length : 0;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="split">
        <div className="stack tight" role="list" aria-label="Drafts waiting for approval">
          <div className="queue">
            {list.map((i, n) => (
              <button key={i.email.id} type="button" role="listitem" className={`queue-item${leaving === i.email.id ? " leaving" : ""}`} aria-current={n === Math.min(at, list.length - 1) ? "true" : undefined} onClick={() => setAt(n)}>
                <span><strong>{i.company}</strong><small>{i.contact ? `${i.contact.name}${i.contact.title ? `, ${i.contact.title}` : ""}` : "No contact"}</small></span>
                <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                  {i.clean ? <Pill tone="good">Clean</Pill> : <Pill tone="warn">Check</Pill>}
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
          <p className="small muted" style={{ margin: "4px 2px 0" }}>
            <span className="kbd">J</span> <span className="kbd">K</span> move · <span className="kbd">A</span> approve · <span className="kbd">E</span> edit · <span className="kbd">R</span> reject
          </p>
        </div>

        {cur ? (
          <div className="stack" style={{ gap: 16 }} key={cur.email.id}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row" style={{ gap: 14 }}>
                {cur.score !== null ? <Ring value={cur.score} size={60} tone={cur.score >= 65 ? "good" : "warn"} label="/100" /> : null}
                <div>
                  <h2 style={{ fontSize: "1.2rem" }}>{cur.company}</h2>
                  <div className="small muted"><Link href={`/prospects/${cur.prospectId}`}>{cur.domain}</Link> · {cur.verdict ?? "unscored"} · <Link href={`/prospects/${cur.prospectId}`}>Why this company</Link></div>
                </div>
              </div>
              <Pill tone={cur.clean ? "good" : "warn"}>{cur.clean ? "Clean draft" : "Look closer"}</Pill>
            </div>

            {!canDecide ? <Banner tone="info" title="Read-only">Viewers can read the drafts. An operator or admin approves or rejects them.</Banner> : null}
            {cur.flags.length ? <Banner tone="warn" title="Worth a look">{cur.flags.join(". ")}.</Banner> : null}
            {failed?.length ? (
              <Banner tone="bad" title="Your edit does not pass the checks">
                <span>{failed.map((f) => f.message).join(" ")}</span>
              </Banner>
            ) : null}

            <article className="mail" aria-label="The email as it will be written">
              <div className="mail-head">
                <div><span className="muted">From </span>{sender}</div>
                <div><span className="muted">To </span>{cur.contact ? <>{cur.contact.name}{cur.contact.title ? `, ${cur.contact.title}` : ""}{cur.contact.email ? ` <${cur.contact.email}>` : ""}</> : "No contact found"}</div>
                {editing ? <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" maxLength={200} style={{ fontWeight: 650 }} /> : <div className="subj">{subject}</div>}
              </div>
              {editing ? (
                <textarea ref={bodyRef} className="mail-edit" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Email body" maxLength={6000} style={{ width: "100%", minHeight: 320, border: 0, borderRadius: 0, fontFamily: "var(--font)", fontSize: "0.97rem", lineHeight: 1.7, padding: "18px 20px" }} />
              ) : (
                <EmailFrame html={renderEmailHtml({ subject, body })} />
              )}
              <div className="mail-foot">
                {testTo ? <span><Icon name="shield" /> Test mode: delivered to {testTo} only</span> : null}
                <button type="button" className="btn ghost small" onClick={() => setShowChecks((v) => !v)} aria-expanded={showChecks}><Icon name="check" />{passed} of {cur.email.checks.length} checks passed</button>
              </div>
            </article>

            {editing && stats ? (
              <div className="card flat stack tight" aria-live="polite">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{stats.ratio === 0 ? "No changes yet" : `${stats.added} added, ${stats.removed} removed, ${Math.round(stats.ratio * 100)}% changed`}</strong>
                  {stats.rewrite ? <Pill tone="warn">Counts as a rewrite</Pill> : stats.ratio > 0 ? <Pill tone="muted">A polish</Pill> : null}
                </div>
                {diff ? <div className="small diff" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{diff.map((s, i) => (s.kind === "ins" ? <ins key={i}>{s.text}</ins> : s.kind === "del" ? <del key={i}>{s.text}</del> : <span key={i}>{s.text}</span>))}</div> : null}
                <label>Note for the record <span className="hint">optional</span><input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why you changed it" /></label>
                <p className="small muted" style={{ margin: 0 }}>Edits must pass the same twelve checks as the original. How much you change is recorded, because it measures whether the drafts are good enough to send.</p>
              </div>
            ) : null}

            {showChecks ? (
              <ul className="checks card flat">
                {cur.email.checks.map((c) => <li key={c.id} className={c.pass ? "ok" : "no"}><span className="tick" aria-hidden>{c.pass ? "✓" : "✕"}</span><span><span className="tag">{c.id}</span> {c.message}</span></li>)}
              </ul>
            ) : null}

            <section className="card stack tight" aria-label="Why this email says what it says">
              <h3>Why it says this</h3>
              {cur.email.hook ? <div className="hook"><strong>The opening rests on this line from their site</strong><div>&ldquo;{cur.email.hook.quote}&rdquo;</div><a className="small" href={cur.email.hook.source} target="_blank" rel="noreferrer noopener">{cur.email.hook.source}</a></div> : <p className="muted small">No hook is recorded for this draft.</p>}
              {cur.email.pains.length ? <p className="small" style={{ margin: 0 }}><span className="muted">Pains addressed: </span>{cur.email.pains.map((p) => p.label).join(" · ")}</p> : null}
              {cur.reasons.length ? (
                <div>
                  <p className="small muted" style={{ margin: "6px 0 2px" }}>Why the company qualified</p>
                  <ul className="stack tight" style={{ margin: 0, paddingLeft: 18 }}>{cur.reasons.map((r) => <li key={r.label} className="small"><strong>+{r.points}</strong> {r.label}{r.quote ? <span className="muted"> &ldquo;{r.quote}&rdquo;</span> : null}</li>)}</ul>
                </div>
              ) : null}
              {cur.contact ? <p className="small" style={{ margin: 0 }}><span className="muted">Contact: </span>{cur.contact.name}{cur.contact.title ? `, ${cur.contact.title}` : ""} · {cur.contact.source === "manual" ? "hand-picked" : "Hunter"}{cur.contact.confidence !== null ? ` · confidence ${cur.contact.confidence}` : ""}{cur.contact.rank !== null ? ` · ranked ${cur.contact.rank}` : ""}</p> : null}
            </section>

            {canDecide ? (
              <div className="sticky-bar" role="group" aria-label="Decide">
                {rejecting ? (
                  <>
                    <div className="row" style={{ flex: 1, minWidth: 260 }}>
                      <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Reason" style={{ width: "auto" }}>{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <input type="text" value={why} onChange={(e) => setWhy(e.target.value)} placeholder={category === "other" ? "What is wrong" : "Add detail (optional)"} aria-label="Detail" style={{ flex: 1, minWidth: 140 }} maxLength={240} />
                    </div>
                    <div className="row">
                      <button type="button" className="btn ghost" onClick={reset}>Cancel <span className="kbd">esc</span></button>
                      <button type="button" className="btn danger" onClick={reject} disabled={busy}>{busy ? "Rejecting…" : "Reject"}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="row">
                      {editing ? <button type="button" className="btn ghost" onClick={reset}>Discard edits <span className="kbd">esc</span></button> : <button type="button" className="btn" onClick={() => { setEditing(true); setTimeout(() => bodyRef.current?.focus(), 30); }}><Icon name="edit" />Edit <span className="kbd">E</span></button>}
                      <button type="button" className="btn ghost" onClick={() => setRejecting(true)}>Reject <span className="kbd">R</span></button>
                    </div>
                    <button type="button" className="btn primary large" onClick={approve} disabled={busy}>{busy ? "Approving…" : editing && stats && stats.ratio > 0 ? "Approve with edits" : "Approve and send"} <span className="kbd" style={{ background: "rgba(255,255,255,0.2)", borderColor: "rgba(255,255,255,0.3)", color: "inherit" }}>{editing ? "⌘↵" : "A"}</span></button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {canDecide && cleanCount > 0 ? (
        <div className="card flat row" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>{cleanCount} clean {cleanCount === 1 ? "draft" : "drafts"}</strong>
            <div className="small muted">Qualified, every check passed, a named contact with good confidence, and a real hook. Approved as written, at most 25 at a time.</div>
          </div>
          <button type="button" className={`btn${confirmAll ? " primary" : ""}`} onClick={bulk} disabled={busy} aria-live="polite">{confirmAll ? `Confirm: approve ${Math.min(cleanCount, 25)}` : "Approve all clean"}</button>
        </div>
      ) : null}
    </div>
  );
}
