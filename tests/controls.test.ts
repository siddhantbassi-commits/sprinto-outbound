import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * "Every control either works or is not shown." This reads every component and page and fails on a control that cannot do
 * anything: a button with no handler that is not a submit, a link to nowhere, a form with no action, a handler that is
 * empty, or a button that is permanently disabled. It reads the real syntax tree, so formatting cannot hide anything.
 * It cannot know that a handler does something useful; it catches the ones that plainly do nothing.
 */

const ROOT = join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

export interface Finding {
  where: string;
  problem: string;
}

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const attrs = (el: Opening) => el.attributes.properties;
const find = (el: Opening, name: string): ts.JsxAttribute | undefined => attrs(el).find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === name);
const hasSpread = (el: Opening) => attrs(el).some((a) => ts.isJsxSpreadAttribute(a));

/** The literal text of an attribute written as a plain string, else null (an expression we cannot judge). */
function literal(a: ts.JsxAttribute | undefined): string | null {
  if (!a || !a.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  if (ts.isJsxExpression(a.initializer) && a.initializer.expression && (ts.isStringLiteral(a.initializer.expression) || ts.isNoSubstitutionTemplateLiteral(a.initializer.expression))) return a.initializer.expression.text;
  return null;
}

/** An arrow function or function with an empty body, or the keyword undefined or null. */
function emptyHandler(a: ts.JsxAttribute): boolean {
  const e = a.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
  if (!e) return false;
  if (e.kind === ts.SyntaxKind.NullKeyword) return true;
  if (ts.isIdentifier(e) && e.text === "undefined") return true;
  if ((ts.isArrowFunction(e) || ts.isFunctionExpression(e)) && ts.isBlock(e.body)) return e.body.statements.length === 0;
  return false;
}

export function inspect(source: string, file = "x.tsx"): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Finding[] = [];
  const at = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText();
      const spread = hasSpread(n);

      // Any handler that is empty is a control that does nothing.
      for (const a of attrs(n)) if (ts.isJsxAttribute(a) && /^on[A-Z]/.test(a.name.getText()) && emptyHandler(a)) out.push({ where: at(n), problem: `<${tag}> has an empty ${a.name.getText()} handler` });

      if (tag === "button") {
        const type = find(n, "type");
        const t = literal(type);
        const hasClick = !!find(n, "onClick");
        const hasFormAction = !!find(n, "formAction");
        if (find(n, "disabled") && !find(n, "disabled")!.initializer) out.push({ where: at(n), problem: "<button> is permanently disabled (a control that is off should be shown as status, not as a dead button)" });
        if (!spread) {
          if (!type) out.push({ where: at(n), problem: "<button> has no type (say type=\"submit\" or type=\"button\" on purpose)" });
          else if (t === "button" && !hasClick && !hasFormAction) out.push({ where: at(n), problem: "<button type=\"button\"> has no onClick, so it does nothing" });
        }
      }

      if (tag === "a" || tag === "Link") {
        const href = find(n, "href");
        const h = literal(href);
        if (!href && !spread) out.push({ where: at(n), problem: `<${tag}> has no href` });
        if (h !== null && (h.trim() === "" || h.trim() === "#" || /^javascript:/i.test(h))) out.push({ where: at(n), problem: `<${tag}> goes nowhere (href="${h}")` });
      }

      if (tag === "form" && !spread && !find(n, "action") && !find(n, "onSubmit")) out.push({ where: at(n), problem: "<form> has neither an action nor an onSubmit" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("the inspector itself", () => {
  it("passes controls that do something", () => {
    const ok = `export const A = () => (<div>
      <button type="submit">Save</button>
      <button type="button" onClick={() => go()}>Go</button>
      <button type="button" formAction={act}>Act</button>
      <button {...props}>Spread</button>
      <a href="/runs">Runs</a><Link href={"/x"}>X</Link><Link href={dynamic}>Y</Link>
      <form action={act}></form><form onSubmit={h}></form>
      <button type="submit" disabled={pending}>Busy</button>
    </div>);`;
    expect(inspect(ok)).toEqual([]);
  });

  it("flags each way a control can do nothing", () => {
    const bad = `export const A = () => (<div>
      <button>No type</button>
      <button type="button">No handler</button>
      <button type="button" onClick={() => {}}>Empty</button>
      <button type="submit" disabled>Always off</button>
      <button type="button" onClick={undefined}>Undefined</button>
      <a href="#">Nowhere</a><a href="">Blank</a><a>No href</a><Link href="javascript:void(0)">Script</Link>
      <form></form>
    </div>);`;
    const problems = inspect(bad).map((f) => f.problem);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining("no type"),
      expect.stringContaining("no onClick"),
      expect.stringContaining("empty onClick"),
      expect.stringContaining("permanently disabled"),
      expect.stringContaining("goes nowhere"),
      expect.stringContaining("has no href"),
      expect.stringContaining("neither an action nor an onSubmit"),
    ]));
    expect(problems.length).toBeGreaterThanOrEqual(10);
  });

  it("reports where the problem is", () => {
    expect(inspect("export const A = () => (\n<div>\n<button>x</button>\n</div>);", "page.tsx")[0]!.where).toBe("page.tsx:3");
  });
});

describe("every control in the app does something", () => {
  const all = files(ROOT);

  it("finds the app's source", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("has no button, link or form that does nothing", () => {
    const findings = all.flatMap((f) => inspect(readFileSync(f, "utf8"), relative(process.cwd(), f)));
    expect(findings.map((f) => `${f.where}: ${f.problem}`)).toEqual([]);
  });
});
