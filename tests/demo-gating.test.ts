import { test } from "node:test";
import assert from "node:assert/strict";
import { footerLinks } from "@/lib/site-links";

/** With demo logins off (a real launch), nothing public links to /demo, which is a 404 then. */
test("the footer links to the demo only when demo logins are on", () => {
  const before = process.env.CLUTCH_DEMO_LOGINS;
  try {
    delete process.env.CLUTCH_DEMO_LOGINS;
    assert.ok(footerLinks().some((l) => l.href === "/demo"), "demo on by default: linked");
    process.env.CLUTCH_DEMO_LOGINS = "off";
    const links = footerLinks().map((l) => l.href);
    assert.ok(!links.includes("/demo"), "demo off: no link to a 404");
    assert.ok(links.includes("/login") && links.includes("/how-it-works"), "the rest of the footer is intact");
  } finally {
    if (before === undefined) delete process.env.CLUTCH_DEMO_LOGINS;
    else process.env.CLUTCH_DEMO_LOGINS = before;
  }
});
