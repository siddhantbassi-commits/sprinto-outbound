"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { describeQuery, isFiltered, toSearch, type LeadQuery, type LeadSort, type OutcomeFilter, type VerdictFilter } from "@/lib/app/lead-query";
import { OUTCOMES } from "@/lib/app/outcomes";

interface Saved {
  name: string;
  search: string;
}
const KEY = "sprinto.leadviews";

const load = (): Saved[] => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is Saved => !!x && typeof x.name === "string" && typeof x.search === "string" && (x.search === "" || x.search.startsWith("?"))).slice(0, 12) : [];
  } catch {
    return [];
  }
};
const save = (v: Saved[]) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked: the views simply are not remembered */
  }
};

/** Search, filters, sort, saved views and the exports. The query lives in the address; saved views are remembered in this browser only. */
export function LeadFilters({ query, shown, total }: { query: LeadQuery; shown: number; total: number }) {
  const router = useRouter();
  const [q, setQ] = useState(query.q);
  const [views, setViews] = useState<Saved[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => setViews(load()), []);
  useEffect(() => setQ(query.q), [query.q]);

  const go = (next: Partial<LeadQuery>) => router.push(`/leads${toSearch({ ...query, ...next })}`);
  const here = toSearch(query);
  const params = here ? `${here}&` : "?";

  return (
    <div className="stack tight lfilters">
      <form className="row" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() }); }} role="search">
        <label className="lsearch"><Icon name="search" /><span className="sr-only">Search leads</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, person, title or pain" maxLength={80} /></label>
        <select value={query.verdict} onChange={(e) => go({ verdict: e.target.value as VerdictFilter })} aria-label="Fit">
          <option value="any">Any fit</option><option value="qualified">Strong fit</option><option value="maybe">Possible fit</option><option value="needs_more">Not enough to judge</option><option value="not_fit">Not a fit</option>
        </select>
        <select value={query.outcome} onChange={(e) => go({ outcome: e.target.value as OutcomeFilter })} aria-label="What happened">
          <option value="any">Any outcome</option><option value="none">Nothing recorded</option>
          {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select value={query.sort} onChange={(e) => go({ sort: e.target.value as LeadSort })} aria-label="Sort by">
          <option value="fit">Best fit first</option><option value="follow">Follow-up date</option><option value="recent">Newest first</option><option value="name">Name</option>
        </select>
        <label className="tickline"><input type="checkbox" checked={query.skipCompetitor} onChange={(e) => go({ skipCompetitor: e.target.checked })} /> Hide those using a competitor</label>
      </form>

      <div className="row between">
        <span className="small muted" role="status">{shown === total ? `${shown} ${shown === 1 ? "lead" : "leads"}` : `${shown} of ${total} leads`}{isFiltered(query) ? ` · ${describeQuery(query)}` : ""}{isFiltered(query) ? <> · <button type="button" className="linkbtn" onClick={() => router.push(`/leads${toSearch({ ...query, q: "", verdict: "any", outcome: "any", skipCompetitor: false })}`)}>Clear filters</button></> : null}</span>
        <span className="row" style={{ gap: 10 }}>
          <a className="btn small" href={`/leads/export${params}format=csv`}><Icon name="down" />CSV</a>
          <a className="btn small" href={`/leads/export${params}format=hubspot`} title="Columns and Lead Status values shaped for a HubSpot import"><Icon name="down" />HubSpot CSV</a>
        </span>
      </div>

      <div className="row" style={{ gap: 8 }}>
        {views.map((v, i) => (
          <span key={`${v.name}-${i}`} className="vchip">
            <Link href={`/leads${v.search}`}>{v.name}</Link>
            <button type="button" aria-label={`Remove the saved view ${v.name}`} onClick={() => { const n = views.filter((_, j) => j !== i); setViews(n); save(n); }}><Icon name="x" /></button>
          </span>
        ))}
        {naming ? (
          <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const nm = name.trim().slice(0, 30); if (!nm) return; const n = [...views.filter((v) => v.name !== nm), { name: nm, search: here }].slice(-12); setViews(n); save(n); setNaming(false); setName(""); }}>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" maxLength={30} aria-label="Name this view" autoFocus />
            <button className="btn small primary" type="submit">Save</button>
            <button className="btn small ghost" type="button" onClick={() => setNaming(false)}>Cancel</button>
          </form>
        ) : (
          <button type="button" className="linkbtn" onClick={() => { setName(describeQuery(query).slice(0, 30)); setNaming(true); }}>Save this view</button>
        )}
      </div>
    </div>
  );
}
