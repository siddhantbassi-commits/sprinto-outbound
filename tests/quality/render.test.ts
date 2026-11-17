import { describe, expect, it } from "vitest";
import { GOLDEN } from "@/lib/quality/golden";
import { goldenOracle, runGolden } from "@/lib/quality/harness";
import { renderGolden } from "@/lib/quality/render";

describe("renderGolden", () => {
  it("says plainly when the stand-in model read it", async () => {
    const run = await runGolden({ ai: goldenOracle() });
    const text = renderGolden(run, "scripted");
    expect(text).toMatch(/^Golden set: PASS/);
    expect(text).toMatch(/stand-in model.*measures nothing/);
    expect(renderGolden(run, "live")).toMatch(/Read by the real model/);
  });

  it("lists why a degraded run did not pass, and which facts differed, without printing any page text", async () => {
    const run = await runGolden({ ai: goldenOracle(GOLDEN, { wrong: ["headcount", "compliance"] }) });
    const text = renderGolden(run, "live");
    expect(text).toMatch(/Golden set: FAIL/);
    expect(text).toMatch(/Why not a pass/);
    expect(text).toMatch(/headcount: wrong/);
    for (const c of GOLDEN) for (const p of c.pages) expect(text).not.toContain(p.text.slice(0, 40));
  });
});
