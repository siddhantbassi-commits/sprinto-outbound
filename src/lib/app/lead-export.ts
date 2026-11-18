/**
 * Leads as a spreadsheet, in two layouts: a plain one for any tool, and one shaped for a CRM import (HubSpot's column names and
 * Lead Status values, so the file can be uploaded as it is). Every cell goes through the same formula-injection guard as the run
 * export, because a company's own name or a scraped reason can begin with "=". Contact addresses are whatever the caller was
 * allowed to see: a viewer's leads carry the masked form, so a viewer's file never holds a real address.
 */

import type { Lead } from "./lead-types";
import { csvRow } from "./list";
import { OUTCOME_BY_ID } from "./outcomes";
import { stageOf, STAGE_BY_ID, type StageId } from "./stages";

export type ExportFormat = "csv" | "hubspot";

/** HubSpot's own Lead Status values. Closed-without-a-conversation maps to UNQUALIFIED, which is the closest it has. */
export const HUBSPOT_STATUS: Record<StageId, string> = {
  to_contact: "NEW",
  reached_out: "ATTEMPTED_TO_CONTACT",
  replied: "CONNECTED",
  meeting_booked: "IN_PROGRESS",
  not_interested: "UNQUALIFIED",
  bounced: "ATTEMPTED_TO_CONTACT",
  wrong_person: "UNQUALIFIED",
};

const stageLabel = (l: Lead) => {
  const s = stageOf(l);
  return s ? STAGE_BY_ID[s].label : "Not worth a call";
};

const note = (l: Lead) => [l.reasons.length ? `Fit: ${l.reasons.join(", ")}.` : "", l.pains.length ? `Pains: ${l.pains.join("; ")}.` : "", l.outcome?.note ? `Last note: ${l.outcome.note}` : "", l.usesCompetitor ? "Already uses a competitor." : ""].filter(Boolean).join(" ");

export function leadsToCsv(leads: Lead[], format: ExportFormat): string {
  const lines: string[] = [];
  if (format === "hubspot") {
    lines.push(csvRow(["Company name", "Company Domain Name", "First Name", "Last Name", "Email", "Job Title", "Lead Status", "Notes"]));
    for (const l of leads) {
      const s = stageOf(l);
      // A contact with no first name is a shared mailbox: put the whole name in Last Name rather than inventing a person.
      lines.push(csvRow([l.name, l.domain, l.contact?.first ?? "", l.contact?.last ?? (l.contact?.first ? "" : (l.contact?.name ?? "")), l.contact?.email ?? "", l.contact?.title ?? "", s ? HUBSPOT_STATUS[s] : "UNQUALIFIED", note(l)]));
    }
  } else {
    lines.push(csvRow(["company", "domain", "fit", "score", "stage", "outcome", "follow_up_on", "contact", "contact_title", "contact_email", "why_it_fits", "pains", "uses_competitor", "last_note"]));
    for (const l of leads) {
      lines.push(csvRow([l.name, l.domain, l.verdict ?? "", l.score ?? "", stageLabel(l), l.outcome ? OUTCOME_BY_ID[l.outcome.status].label : "", l.outcome?.followUpOn ?? "", l.contact?.name ?? "", l.contact?.title ?? "", l.contact?.email ?? "", l.reasons.join("; "), l.pains.join("; "), l.usesCompetitor ? "yes" : "no", l.outcome?.note ?? ""]));
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
