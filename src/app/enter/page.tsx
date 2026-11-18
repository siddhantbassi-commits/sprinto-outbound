import { redirect } from "next/navigation";
import { Intro } from "./intro";
import { safeDestination } from "@/lib/app/enter";
import { readEnv } from "@/lib/env";

export const metadata = { title: "Welcome to Sprinto Outbound" };

export default async function Enter({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const to = safeDestination((await searchParams).to);
  // Only the demo and the guest pass have a welcome; anywhere else the way in is the sign-in page, or the app itself.
  const env = readEnv();
  const kind = env.mode === "demo" ? "demo" : env.guest ? "guest" : null;
  if (!kind) redirect(to);
  return <Intro to={to} kind={kind} />;
}
