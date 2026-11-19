import Link from "next/link";
import { Icon } from "./icons";
import { Pill } from "./ui";
import { actionFor, type ReadyItem } from "@/lib/app/readiness";

/** The button beside an unfinished checklist item: a real link to the right place, or a plain note when there is nowhere to go. */
export function ItemAction({ item, here }: { item: ReadyItem; here: string }) {
  const a = actionFor(item, here);
  return a.kind === "link" ? (
    <Link className="btn small" href={a.href}>{a.label}<Icon name="arrow" /></Link>
  ) : (
    <Pill tone="warn">{a.label}</Pill>
  );
}
