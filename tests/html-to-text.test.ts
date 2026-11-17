import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToText, THIN_CHARS } from "@/lib/scrape/html-to-text";

const BASE = "https://acme.com/";
const run = (html: string) => htmlToText(html, BASE);

describe("htmlToText: what is kept and what is dropped", () => {
  it("keeps headings and body text and drops scripts and styles", () => {
    const out = run(`<html><head><style>.x{color:red}</style></head><body><h1>Acme Cloud</h1><p>We help teams ship.</p><script>var secret = "token123";</script></body></html>`);
    expect(out.text).toContain("Acme Cloud");
    expect(out.text).toContain("We help teams ship.");
    expect(out.text).not.toContain("secret");
    expect(out.text).not.toContain("color:red");
  });

  it("does not let a '<' inside a script leak the rest of the script as text", () => {
    const out = run(`<body><p>Visible</p><script>if (a<b) { document.write("<p>LEAK</p>"); }</script><p>After</p></body>`);
    expect(out.text).toContain("Visible");
    expect(out.text).toContain("After");
    expect(out.text).not.toContain("LEAK");
  });

  it("keeps image alt text, because compliance badges are images", () => {
    const out = run(`<footer><img src="/b.png" alt="SOC 2 Type II certified"><img src="/c.png" alt="" title="ISO 27001"></footer>`);
    expect(out.text).toContain("[image: SOC 2 Type II certified]");
    expect(out.text).toContain("[image: ISO 27001]");
  });

  it("drops navigation text but still returns its links", () => {
    const out = run(`<nav><a href="/pricing">Pricing</a><a href="/security">Security</a></nav><main><p>Hello there</p></main>`);
    expect(out.text).not.toMatch(/Pricing/);
    expect(out.text).toContain("Hello there");
    expect(out.links.map((l) => l.href)).toEqual(["https://acme.com/pricing", "https://acme.com/security"]);
    expect(out.links[0]?.text).toBe("Pricing");
  });

  it("drops text inside nested svg, noscript and template", () => {
    const out = run(`<p>Keep</p><svg><g><title>icon-title</title></g></svg><noscript><p>enable js</p></noscript><template><p>tmpl</p></template>`);
    expect(out.text).toContain("Keep");
    expect(out.text).not.toMatch(/icon-title|enable js|tmpl/);
  });

  it("removes comments, including ones that hide tags", () => {
    const out = run(`<p>Real</p><!-- <p>hidden text</p> --><p>More</p>`);
    expect(out.text).not.toContain("hidden text");
    expect(out.text).toContain("More");
  });

  it("reads the title and the meta description", () => {
    const out = run(`<head><title>Acme | Cloud platform</title><meta name="description" content="Acme runs your infrastructure."><meta property="og:title" content="Acme OG"></head><body><p>Body copy here.</p></body>`);
    expect(out.title).toBe("Acme | Cloud platform");
    expect(out.text).toContain("Page title: Acme | Cloud platform");
    expect(out.text).toContain("Acme runs your infrastructure.");
    expect(out.text).toContain("Acme OG");
  });

  it("keeps readable JSON-LD strings and ignores URLs and malformed blocks", () => {
    const out = run(
      `<script type="application/ld+json">{"@type":"Organization","name":"Acme Inc","description":"Infra for SaaS","url":"https://acme.com","numberOfEmployees":{"value":120},"sameAs":["https://x.com/acme"]}</script><script type="application/ld+json">{ not json</script><p>x</p>`,
    );
    expect(out.text).toContain("Acme Inc");
    expect(out.text).toContain("Infra for SaaS");
    expect(out.text).not.toContain("https://x.com/acme");
  });

  it("puts each block on its own line and table cells on one", () => {
    const out = run(`<div>One</div><div>Two</div><table><tr><td>Plan</td><td>Enterprise</td></tr></table>`);
    expect(out.text.split("\n")).toEqual(expect.arrayContaining(["One", "Two"]));
    expect(out.text).toMatch(/Plan \| Enterprise/);
  });

  it("drops repeated lines, as footers and cookie banners repeat", () => {
    const out = run(`<p>Accept cookies</p><p>Real content here</p><p>accept cookies</p>`);
    expect(out.text.match(/accept cookies/gi)).toHaveLength(1);
  });

  it("copes with a '>' inside a quoted attribute", () => {
    const out = run(`<a title="a>b" href="/x">Link text</a><p>After</p>`);
    expect(out.links[0]?.href).toBe("https://acme.com/x");
    expect(out.text).toContain("After");
  });

  it("does not crash on unclosed tags, unclosed scripts or empty input", () => {
    expect(() => run(`<div><p>open <b>bold <script>never closed`)).not.toThrow();
    expect(run("").text).toBe("");
    expect(run("<").text).toBe("<");
  });

  it("caps the text it returns", () => {
    const out = run(`<p>${"word ".repeat(60_000)}</p>`);
    expect(out.text.length).toBeLessThanOrEqual(120_000);
  });
});

describe("htmlToText: links", () => {
  it("resolves relative links, strips fragments, dedupes, and drops mailto, tel and javascript", () => {
    const out = run(
      `<a href="/about#team">About</a><a href="/about">About again</a><a href="mailto:a@b.co">mail</a><a href="tel:123">call</a><a href="javascript:alert(1)">js</a><a href="#top">top</a><a href="ftp://x.co/f">ftp</a><a href="https://other.com/p">Other</a>`,
    );
    expect(out.links.map((l) => l.href)).toEqual(["https://acme.com/about", "https://other.com/p"]);
  });

  it("caps the number of links", () => {
    const html = Array.from({ length: 500 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("");
    expect(run(html).links.length).toBeLessThanOrEqual(300);
  });
});

describe("htmlToText: thin pages", () => {
  it("flags a page that is nearly empty, as a JavaScript-only app shell is", () => {
    expect(run(`<div id="root"></div><script src="/app.js"></script>`).thin).toBe(true);
    expect(run(`<p>${"real words ".repeat(60)}</p>`).thin).toBe(false);
    expect(THIN_CHARS).toBe(400);
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex entities", () => {
    expect(decodeEntities("A &amp; B &lt;3 &#39;x&#39; &#x41; &mdash; &nbsp;done")).toBe("A & B <3 'x' A -  done");
  });
  it("leaves unknown names alone and neutralises invalid code points", () => {
    expect(decodeEntities("&bogus; &#0; &#xD800; &#99999999;")).toMatch(/^&bogus;\s+&#99999999;$/);
  });
});
