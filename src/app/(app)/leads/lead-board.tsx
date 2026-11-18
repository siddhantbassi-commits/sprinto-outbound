"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveLead } from "./actions";
import { toast } from "@/components/toast";
import { Pill } from "@/components/ui";
import type { Lead } from "@/lib/app/lead-types";
import { dayOf, followUpOf, followUpText } from "@/lib/app/outcomes";
import { canMoveTo, groupByStage, STAGES, stageOf, type StageId } from "@/lib/app/stages";

/**
 * The pursuit as columns. A card can be dragged to another column, or moved with the select on the card (so it works with a
 * keyboard and on a phone). Moving records the outcome, the same way the form does; a card cannot be moved back to "To contact",
 * because that is not something that happened.
 */
export function LeadBoard({ leads, canMove }: { leads: Lead[]; canMove: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Record<string, StageId>>({});
  const [over, setOver] = useState<StageId | null>(null);
  const [pending, start] = useTransition();
  const today = dayOf(Date.now());
  const now = (l: Lead): StageId => stage[l.id] ?? stageOf(l) ?? "to_contact";
  const cols = groupByStage(leads.map((l) => ({ ...l, outcome: stage[l.id] ? { status: stage[l.id] as never, note: l.outcome?.note ?? "", followUpOn: null, at: "" } : l.outcome })));

  const move = (l: Lead, to: StageId) => {
    if (!canMove || !canMoveTo(to) || now(l) === to) return;
    const from = stage[l.id];
    setStage((m) => ({ ...m, [l.id]: to }));
    start(async () => {
      const r = await moveLead(l.id, to);
      toast(r.message, r.ok);
      if (!r.ok) setStage((m) => { const n = { ...m }; if (from) n[l.id] = from; else delete n[l.id]; return n; });
      else router.refresh();
    });
  };

  return (
    <div className="board" aria-busy={pending}>
      {STAGES.map((st) => (
        <section
          key={st.id}
          className={`bcol${over === st.id ? " over" : ""}${st.closed ? " closed" : ""}`}
          aria-label={st.label}
          onDragOver={(e) => { if (canMove && canMoveTo(st.id)) { e.preventDefault(); setOver(st.id); } }}
          onDragLeave={() => setOver((o) => (o === st.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData("text/plain");
            const l = leads.find((x) => x.id === id);
            if (l) move(l, st.id);
          }}
        >
          <header title={st.help}><b>{st.label}</b><span className="count">{cols[st.id].length}</span></header>
          <ul>
            {cols[st.id].length === 0 ? <li className="bempty">{canMove && canMoveTo(st.id) ? "Drop a lead here" : "Nothing here"}</li> : null}
            {cols[st.id].map((l) => {
              const f = followUpOf(l.outcome, today);
              return (
                <li key={l.id} className="bcard" draggable={canMove} onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; }}>
                  <div className="row between" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <Link href={`/prospects/${l.id}/brief`}><b>{l.name}</b></Link>
                    <span className="bscore" title="Fit score">{l.score ?? "-"}</span>
                  </div>
                  <div className="small muted">{l.contact ? `${l.contact.name}${l.contact.title ? `, ${l.contact.title}` : ""}` : "No named person yet"}</div>
                  <div className="row" style={{ gap: 6 }}>
                    {f ? <Pill tone={f.state === "overdue" ? "bad" : f.state === "today" ? "warn" : "info"}>{followUpText(f)}</Pill> : null}
                    {l.usesCompetitor ? <Pill tone="warn" title="The rubric found a competitor's trust centre on their site.">Uses a competitor</Pill> : null}
                  </div>
                  {canMove ? (
                    <label className="bmove">
                      <span className="sr-only">Move {l.name} to</span>
                      <select value="" onChange={(e) => move(l, e.target.value as StageId)} aria-label={`Move ${l.name} to another stage`}>
                        <option value="">Move to…</option>
                        {STAGES.filter((x) => canMoveTo(x.id) && x.id !== now(l)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
