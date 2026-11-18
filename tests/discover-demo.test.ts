import { describe, expect, it } from "vitest";
import { getDemo, demoFetchDeps, demoHunter } from "@/lib/demo/world";
import { pgPort } from "@/lib/db/pg-port";
import { loadKnown } from "@/lib/app/known";
import { defaultCriteria } from "@/lib/discovery/criteria";
import { discover } from "@/lib/discovery/discover";
import { ICP_V1 } from "@/lib/icp/config";

describe("discovery in demo mode (the real discovery code on the stand-in Hunter and the pretend internet)", () => {
  it("finds software companies, drops the hotel and the competitor, and shows what the sample run already read", async () => {
    const demo = await getDemo();
    const db = pgPort(demo.db.as(demo.users.operator));
    const known = await loadKnown(db, 30);
    expect(known.researched.has("northwind.io")).toBe(true);
    expect(known.researched.has("meridiancare.io")).toBe(false);

    const o = await discover({ ...defaultCriteria(ICP_V1), want: 10 }, { hunter: demoHunter(), fetchDeps: demoFetchDeps(), known });
    const fresh = o.found.filter((f) => f.standing === "new").map((f) => f.domain);
    expect(fresh).toEqual(expect.arrayContaining(["meridiancare.io", "tesseldata.com", "fathompay.com", "ledgerlight.io"]));
    expect(fresh).not.toContain("seaviewhotel.com");
    expect(o.found.map((f) => f.domain)).not.toContain("vanta.com");
    expect(o.hidden.notSoftware).toBeGreaterThanOrEqual(1);
    expect(o.found.some((f) => f.standing === "researched")).toBe(true);

    // A company that three angles agree on, with a hiring signal, outranks one only the software angle found.
    const meridian = o.found.find((f) => f.domain === "meridiancare.io")!;
    const ledger = o.found.find((f) => f.domain === "ledgerlight.io")!;
    expect(meridian.angles).toEqual(["hiring", "software", "regulated"]);
    expect(ledger.angles).toEqual(["software"]);
    expect(fresh.indexOf("meridiancare.io")).toBeLessThan(fresh.indexOf("ledgerlight.io"));
    expect(meridian.about).not.toBe("");
  }, 60_000);
});
