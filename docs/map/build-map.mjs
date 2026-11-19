// Builds docs/Sprinto-Outbound-Components-Map.pdf in the same format as Freshroots-Components-Map.pdf:
// 7 columns (Actor, Trigger, Input, Context, Processing, AI, Output), one row per actor, dashed arrows in flow order,
// and a HUMAN BOUNDARY box. Edit the ROWS / LINKS below, then run:  node docs/map/build-map.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_HTML = join(here, "map.html");
const OUT_PDF = join(here, "..", "Sprinto-Outbound-Components-Map.pdf");
const OUT_PNG = join(here, "map-preview.png");

const TITLE = "MESA AI-Native Track · Sprinto Outbound: Components Map";
const SUBTITLE =
  "Domains in, a decision trail out: scrape, extract, qualify, find the person, pick two pains, draft, send. AI is Gemini, used to read and write. Code, not the model, decides who qualifies, and a person approves every email before it is sent.";
const BOUNDARY = [
  "The platform researches, scores and drafts, and sends only what a person has approved. In test mode every email goes to an inbox a person can read: the Growth Lead's own, or a reviewer's own address once they prove it with a code. No prospect is ever mailed. Gemini only reads page text and writes drafts: it never picks a recipient, changes a score or sends anything. Every score comes from code, on facts that carry a quote from the page.",
  "Which companies to pursue, whether each draft goes out, whether to ever go live, and what to say when someone replies stays with the Growth Lead. Going live is a deliberate admin change after review, not a button anyone can press. The Scorecard says when to stop: over half the drafts rewritten, the wrong person more than 4 times in 10, or more time spent than saved.",
];
const FOOTER = "Open, no sign-in (guest access): sprinto-outbound-eight.vercel.app  ·  Owner sign-in at /login  ·  Test mode: never a prospect  ·  MESA AI-Native Track Case 02";

const COLS = ["Actor", "Trigger", "Input", "Context", "Processing", "AI", "Output"];
const KIND = ["", "trigger", "input", "context", "processing", "ai", "output"];

// Each row: actor name, subtitle, tint, and boxes keyed by column index (1 to 6).
const ROWS = [
  {
    name: "Growth Lead", sub: "(Sprinto · human)", tint: "#fdfaf2",
    boxes: {
      1: "She opens Discover to find companies, or has a list of domains ready",
      2: "Her criteria and the companies she picks, or pasted domains; her call on each maybe and draft",
      6: "Today (what needs her), progress with time left, a leads board with a call brief each, drafts to approve, a plain 'why' for every company",
    },
  },
  {
    name: "Company discovery", sub: "(Hunter Discover · paste · CSV)", tint: "#fdf5ea",
    boxes: {
      3: "Three free Hunter searches from the ICP, merged and ranked, home pages checked; a Monday digest of new ones; or pasted text",
      4: "Saved as a run with one job per domain; a domain mailed in the last 30 days is skipped",
    },
  },
  {
    name: "Outbound app", sub: "(Next.js on Vercel · guest or owner)", tint: "#eff8f1",
    boxes: {
      1: "A GitHub Actions worker every 15 minutes and a digest job on Mondays, or a live run open in the browser",
      3: "Owner by sign-in, guest by link with spend caps. Loads the signed-off ICP, verified facts and daily caps",
      4: "Claims the next step of the next job; each step is saved before the next begins; failures retried with back-off",
    },
  },
  {
    name: "Scrape and extract", sub: "(Steps 1 and 2 · code + Gemini)", tint: "#fcf0f5",
    boxes: {
      3: "Public pages only: home, about, pricing, security, careers, customers; robots.txt obeyed; private addresses blocked",
      4: "Page text cleaned and stored with a hash; company facts pulled out, each with a quote that must appear on the page",
      6: "Company card with its evidence; a page that failed to load is a stated reason, not a silent skip",
    },
  },
  {
    name: "ICP gate", sub: "(Step 3 · code, not the AI)", tint: "#f2f1fa",
    boxes: {
      3: "Thin data? Gemini may ask for up to 8 more pages (4 rounds, 5 safe tools); code re-scores each time",
      4: "Score 0 to 100 from the facts using the signed-off ICP weights: same facts, same score",
      6: "Fit, maybe or not a fit, with the reason; a maybe waits for a person, thin data says 'needs more', never a guess",
    },
  },
  {
    name: "Contact finder", sub: "(Step 4 · Hunter or hand-picked)", tint: "#eef4fc",
    boxes: {
      2: "Hunter domain search, or the hand-picked contact; only for companies that qualified or were promoted",
      3: "Hunter credits left, 30-day cache, titles ranked for the company's size and stage",
      4: "People ranked by title, seniority and verified email; one is chosen, with the reason",
      6: "A contact with name, title and proof; nobody found goes to the review lane",
    },
  },
  {
    name: "Database", sub: "(Supabase · Postgres)", tint: "#fdf6ec",
    boxes: {
      3: "Runs, evidence, contacts, drafts, reviews, outcomes, digests, ICP versions, suppressions; owner sign-in, guest account; row level security",
      4: "Append-only: no edits or deletes; time and name stamped by the database",
    },
  },
  {
    name: "AI model", sub: "(Gemini · reads and writes only)", tint: "#f0f7ee",
    boxes: {
      3: "Page text sent as data, never as instructions; only a first name and title, no contact email addresses, passwords or keys",
      5: "Pulls out facts, picks pages to fetch (4 rounds at most), chooses two pains, drafts the email",
    },
  },
  {
    name: "Pitch builder", sub: "(Steps 5 and 6 · Gemini + code)", tint: "#fcf0f5",
    boxes: {
      3: "Pain library, the verified Sprinto facts file, the contact's title and the company's strongest quotes",
      4: "Two pains chosen with evidence; draft checked 12 ways: length, name, grounded hook, one ask, opt-out line, address",
      6: "Subject and body with the hook's source shown; a draft that fails is held, never sent",
    },
  },
  {
    name: "Review desk", sub: "(Step 6b · the Growth Lead decides)", tint: "#fff6ea",
    boxes: {
      1: "A draft is parked for a person; nothing has been sent",
      2: "She approves, edits or rejects with a reason; clean drafts can be approved together",
      3: "The draft, its hook quote and page, why the company scored, the contact, any flags",
      4: "Edits re-checked (12 checks); a reviewer may get the test email in their own inbox, proved by a code",
      6: "Approved text goes to delivery; rewrite rate and contact accuracy feed the Scorecard",
    },
  },
  {
    name: "Delivery", sub: "(Step 7 · Gmail)", tint: "#eef4fc",
    boxes: {
      1: "She approved the draft and today's send cap (20 a day) is not reached",
      2: "The approved text; the owner's address, or a reviewer's own address proved by a code; the real contact kept as a note",
      3: "Test mode: never to a prospect; a reviewer address needs a code and is capped per day; one send per domain",
      4: "Sent through the Gmail API with send-only permission as a formal HTML and plain-text letter; message id saved; failures retried",
      6: "Formal email with a notice under it: 'Would have gone to name, title'; still failing after retries is held",
    },
  },
  {
    name: "Leads and follow-up", sub: "(Today · board · outcomes · go-live)", tint: "#f1f7fb",
    boxes: {
      1: "She opens Today, or the Monday digest lands in her inbox",
      2: "She records what came of each lead (replied, meeting, not interested) with a note and a follow-up date",
      3: "Researched companies, the verified Sprinto facts, outcomes so far, and the sending domain's SPF, DKIM and DMARC",
      4: "Board stages by code; framework map, call plan, score chart; paid address check; outcomes compared with the ICP",
      6: "Leads board, side-by-side compare, one-page PDF brief, CSV and HubSpot export, 'what is working', go-live list",
    },
  },
  {
    name: "Operations and Quality", sub: "(Budgets · Suppression · Scorecard)", tint: "#fdf1f1",
    boxes: {
      1: "A run ends, or a week closes",
      2: "She suppresses a domain, promotes a maybe, hand-picks a contact, edits the ICP with a reason",
      3: "Hunter and Gemini budgets, suppression list, golden set of known companies, shut-down rules",
      4: "Funnel and drop-offs; quality watch; replay another ICP on stored facts; kill criteria",
      6: "Weekly report with time saved and its working; Scorecard; run results as CSV",
    },
  },
];

// Flow arrows. "r,c" = row index (1 based) and column index (1 based). Types: h = same row, v = same column downward,
// dr = down then right (next row, box to the right), dl = down then left into the right edge, rail = far-right line up.
const LINKS = [
  ["h", "1,1", "1,2"], ["dr", "1,2", "2,3"],
  ["h", "2,3", "2,4"], ["v", "2,4", "3,4"],
  ["h", "3,1", "3,3"], ["h", "3,3", "3,4"], ["v", "3,4", "4,4"],
  ["h", "4,3", "4,4"], ["h", "4,4", "4,6"], ["v", "4,4", "5,4"],
  ["h", "5,3", "5,4"], ["h", "5,4", "5,6"], ["v", "5,4", "6,4"],
  ["h", "6,2", "6,3"], ["h", "6,3", "6,4"], ["h", "6,4", "6,6"], ["v", "6,4", "7,4"],
  ["h", "7,3", "7,4"], ["dr", "7,4", "8,5"],
  ["h", "8,3", "8,5"], ["dl", "8,5", "9,4"],
  ["h", "9,3", "9,4"], ["h", "9,4", "9,6"], ["v", "9,4", "10,4"],
  ["h", "10,1", "10,2"], ["h", "10,2", "10,3"], ["h", "10,3", "10,4"], ["h", "10,4", "10,6"], ["v", "10,4", "11,4"],
  ["h", "11,1", "11,2"], ["h", "11,2", "11,3"], ["h", "11,3", "11,4"], ["h", "11,4", "11,6"], ["v", "11,4", "12,4"],
  ["h", "12,1", "12,2"], ["h", "12,2", "12,3"], ["h", "12,3", "12,4"], ["h", "12,4", "12,6"], ["v", "12,4", "13,4"],
  ["h", "13,1", "13,2"], ["h", "13,2", "13,3"], ["h", "13,3", "13,4"], ["h", "13,4", "13,6"],
  ["rail", "11,6", "1,6"],
];

// ---- layout ----
const W = 1500;
const MARGIN = 30;
const ACTOR_X = MARGIN, ACTOR_W = 168;
const COL0 = ACTOR_X + ACTOR_W + 12; // first of the six columns
const COL_W = (W - MARGIN - COL0 - 16) / 6;
const BOX_W = COL_W - 22, BOX_H = 60;
const ROW_H = 78;
const TITLE_Y = 38, SUB_Y = 58;
const HEAD_Y = 74, HEAD_H = 40;
const ROWS_Y = HEAD_Y + HEAD_H + 10;
const rowsEnd = ROWS_Y + ROWS.length * ROW_H;
const BOUND_Y = rowsEnd + 14, BOUND_H = 112;
const H = BOUND_Y + BOUND_H + 44;

const cx = (c) => COL0 + (c - 1) * COL_W + COL_W / 2;
const cy = (r) => ROWS_Y + (r - 1) * ROW_H + ROW_H / 2;
const box = (ref) => {
  const [r, c] = ref.split(",").map(Number);
  return { x: cx(c), y: cy(r), l: cx(c) - BOX_W / 2, r: cx(c) + BOX_W / 2, t: cy(r) - BOX_H / 2, b: cy(r) + BOX_H / 2 };
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- arrows ----
const paths = [];
for (const [type, a, b] of LINKS) {
  const A = box(a), B = box(b);
  let pts;
  if (type === "h") pts = [[A.r, A.y], [B.l, B.y]];
  else if (type === "v") pts = [[A.x, A.b], [B.x, B.t]];
  else if (type === "dr") pts = [[A.r, A.y], [B.x, A.y], [B.x, B.t]];
  else if (type === "dl") pts = [[A.x, A.b], [A.x, B.y - 18], [B.r, B.y - 18]]; // enters above the box's own outgoing arrow
  else if (type === "rail") {
    const railX = B.r + 12;
    pts = [[A.r, A.y], [railX, A.y], [railX, B.y], [B.r, B.y]];
  }
  paths.push(`<path d="M ${pts.map((p) => p.join(" ")).join(" L ")}" marker-end="url(#arrow)"/>`);
}

// ---- html ----
const rowBands = ROWS.map(
  (row, i) =>
    `<div class="band" style="top:${ROWS_Y + i * ROW_H}px;height:${ROW_H - 4}px;background:${row.tint}"></div>` +
    `<div class="actor" style="top:${ROWS_Y + i * ROW_H}px;height:${ROW_H - 4}px"><b>${esc(row.name)}</b><span>${esc(row.sub)}</span></div>`,
).join("\n");

const boxes = ROWS.flatMap((row, i) =>
  Object.entries(row.boxes).map(([c, text]) => {
    const col = Number(c);
    const b = box(`${i + 1},${col}`);
    return `<div class="box ${KIND[col]}" style="left:${b.l}px;top:${b.t}px;width:${BOX_W}px;height:${BOX_H}px">${esc(text)}</div>`;
  }),
).join("\n");

const header = COLS.map((name, i) => {
  const left = i === 0 ? ACTOR_X : COL0 + (i - 1) * COL_W;
  const width = i === 0 ? ACTOR_W : COL_W;
  return `<div class="hcell" style="left:${left}px;width:${width}px">${name}</div>`;
}).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(TITLE)}</title>
<style>
  @page { size: ${W}px ${H}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { width: ${W}px; height: ${H}px; position: relative; font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; color: #1e3a5f; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .title { position: absolute; top: 14px; left: 0; width: ${W}px; text-align: center; font-size: 29px; font-weight: 700; letter-spacing: -0.3px; color: #1f3a63; }
  .sub { position: absolute; top: 52px; left: 0; width: ${W}px; text-align: center; font-size: 11.5px; color: #6b7280; }
  .headbar { position: absolute; left: ${MARGIN - 4}px; top: ${HEAD_Y}px; width: ${W - 2 * MARGIN + 8}px; height: ${HEAD_H}px; background: #1f3a63; border-radius: 16px; }
  .hcell { position: absolute; top: ${HEAD_Y}px; height: ${HEAD_H}px; line-height: ${HEAD_H}px; text-align: center; color: #fff; font-weight: 700; font-size: 15px; }
  .hsep { position: absolute; top: ${HEAD_Y + 4}px; width: 2px; height: ${HEAD_H - 8}px; background: #f2c744; }
  .band { position: absolute; left: ${MARGIN - 4}px; width: ${W - 2 * MARGIN + 8}px; }
  .actor { position: absolute; left: ${ACTOR_X}px; width: ${ACTOR_W}px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
  .actor b { font-size: 14.5px; color: #1f3a63; }
  .actor span { font-size: 10px; color: #6b7280; margin-top: 3px; }
  .box { position: absolute; border-radius: 10px; border: 1.3px solid; padding: 5px 8px; font-size: 10.4px; line-height: 12.8px; text-align: center; display: flex; align-items: center; justify-content: center; color: #374151; }
  .trigger { background: #efe8fb; border-color: #7a5ad3; }
  .input { background: #e5f0fc; border-color: #4a8fdc; }
  .context { background: #e3f5e8; border-color: #45ad68; }
  .processing { background: #fdf0d2; border-color: #e3a620; }
  .ai { background: #fde4f0; border-color: #de4f9b; }
  .output { background: #fde7e3; border-color: #de574a; }
  svg { position: absolute; left: 0; top: 0; }
  svg path { fill: none; stroke: #6b7280; stroke-width: 1.4; stroke-dasharray: 5 4; }
  .boundary { position: absolute; left: ${MARGIN}px; top: ${BOUND_Y}px; width: ${W - 2 * MARGIN}px; height: ${BOUND_H}px; border: 1.4px solid #de574a; border-radius: 14px; background: #fff7f5; display: flex; align-items: center; }
  .boundary .lab { width: 190px; text-align: center; font-weight: 700; font-size: 14px; color: #d4493b; letter-spacing: .3px; }
  .boundary .txt { flex: 1; padding-right: 22px; font-size: 11.6px; line-height: 16.5px; color: #374151; }
  .boundary .txt p { margin: 0 0 5px; }
  .foot { position: absolute; right: ${MARGIN}px; top: ${BOUND_Y + BOUND_H + 14}px; font-size: 9.5px; color: #6b7280; }
</style></head>
<body>
  <div class="title">${esc(TITLE)}</div>
  <div class="sub">${esc(SUBTITLE)}</div>
  <div class="headbar"></div>
  ${header}
  ${Array.from({ length: 6 }, (_, i) => `<div class="hsep" style="left:${i === 0 ? ACTOR_X + ACTOR_W + 5 : COL0 + i * COL_W - 1}px"></div>`).join("")}
  ${rowBands}
  <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#6b7280" stroke="none" style="stroke-dasharray:none"/></marker></defs>
    ${paths.join("\n    ")}
  </svg>
  ${boxes}
  <div class="boundary"><div class="lab">HUMAN BOUNDARY</div><div class="txt">${BOUNDARY.map((p) => `<p>${esc(p)}</p>`).join("")}</div></div>
  <div class="foot">${esc(FOOTER)}</div>
</body></html>`;

writeFileSync(OUT_HTML, html);

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${W},${H}`];
const url = "file://" + OUT_HTML;
execFileSync(chrome, [...base, "--no-pdf-header-footer", `--print-to-pdf=${OUT_PDF}`, url], { stdio: "ignore" });
execFileSync(chrome, [...base, `--screenshot=${OUT_PNG}`, url], { stdio: "ignore" });
console.log("wrote", OUT_PDF, `(${W} x ${H})`);
