"use client";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toast";
import { clearReviewer, confirmReviewerCode, requestReviewerCode, type ReviewerResult } from "./reviewer-actions";

/**
 * Lets the reviewer have the test email delivered to their own inbox. They enter an address, receive a six-digit code there, and type
 * it in: that proves the address is theirs. Until they do, test emails go to the owner's address as before.
 */
export function ReviewerInbox({ confirmed, ownerAddress }: { confirmed: string | null; ownerAddress: string | null }) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<ReviewerResult | null>(null);

  const run = (fn: () => Promise<ReviewerResult>, after?: (r: ReviewerResult) => void) =>
    start(async () => {
      const r = await fn();
      setNote(r);
      toast(r.message, r.ok);
      after?.(r);
    });

  if (confirmed) {
    return (
      <div className="card" style={{ padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }} data-tour="reviewer-inbox">
        <Icon name="shield" />
        <span className="small" style={{ flex: 1, minWidth: 220 }}>
          <strong>Test emails go to your own inbox</strong> ({confirmed}). Each is labelled as a test. This lasts a day in this browser.
        </span>
        <button type="button" className="btn ghost small" disabled={pending} onClick={() => run(clearReviewer)}>Use the owner&apos;s address</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: "12px 16px" }} data-tour="reviewer-inbox">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Icon name="mail" />
        <span className="small" style={{ flex: 1, minWidth: 220 }}>
          <strong>Want the test email in your own inbox?</strong> {ownerAddress ? "By default it goes to the owner's address. " : ""}Confirm your address with a short code and approved emails come to you instead.
        </span>
        {!open ? <button type="button" className="btn small" onClick={() => setOpen(true)}>Use my email address</button> : null}
      </div>
      {open ? (
        <form
          className="stack tight"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!sent) run(() => requestReviewerCode(address), (r) => r.ok && setSent(true));
            else run(() => confirmReviewerCode(address, code), (r) => r.ok && (setSent(false), setCode("")));
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="email" name="reviewer_address" placeholder="your email address" value={address} onChange={(e) => setAddress(e.target.value)} disabled={sent || pending} maxLength={254} required aria-label="Your email address" autoComplete="email" style={{ flex: 1, minWidth: 220 }} />
            {!sent ? <button type="submit" className="btn small" disabled={pending || address.trim().length < 5}>{pending ? "Sending…" : "Send me a code"}</button> : null}
          </div>
          {sent ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input type="text" name="reviewer_code" inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={9} aria-label="The six-digit code" style={{ width: 160 }} autoFocus />
              <button type="submit" className="btn small" disabled={pending || code.replace(/\D/g, "").length !== 6}>{pending ? "Checking…" : "Confirm"}</button>
              <button type="button" className="btn ghost small" disabled={pending} onClick={() => { setSent(false); setCode(""); setNote(null); }}>Use a different address</button>
            </div>
          ) : null}
          {note ? <p className="small" role="status" style={{ margin: 0 }}>{note.message}</p> : null}
          <p className="small muted" style={{ margin: 0 }}>The code is only sent to the address you type, and it is how we know the inbox is yours. Nothing else is ever sent there.</p>
        </form>
      ) : null}
    </div>
  );
}
