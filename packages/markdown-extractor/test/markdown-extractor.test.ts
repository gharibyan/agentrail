import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMarkdown } from "../src/index.js";

test("extracts deterministic Markdown from main content", () => {
  const html = `
    <!doctype html>
    <html>
      <head>
        <title>Pricing | Example</title>
        <meta name="description" content="Simple pricing for teams.">
        <link rel="canonical" href="https://example.com/pricing">
      </head>
      <body>
        <nav><a href="/noise">Navigation</a></nav>
        <main>
          <h1>Pricing</h1>
          <p>Choose the plan that fits your team.</p>
          <h2>Plans</h2>
          <ul>
            <li>Starter: $9 per month</li>
            <li>Pro: $29 per month</li>
          </ul>
          <p><a href="/signup">Start trial</a></p>
        </main>
        <footer>Copyright</footer>
        <script>window.noise = true</script>
      </body>
    </html>
  `;

  const markdown = extractMarkdown({
    html,
    url: "https://example.com/pricing?ref=agent",
    generatedAt: "2026-06-03T00:00:00.000Z"
  });

  assert.match(markdown, /^# Pricing \| Example/);
  assert.match(markdown, /Canonical URL: https:\/\/example.com\/pricing/);
  assert.match(markdown, /Last generated: 2026-06-03T00:00:00.000Z/);
  assert.match(markdown, /## Description\nSimple pricing for teams\./);
  assert.match(markdown, /## Content\n# Pricing\n\nChoose the plan that fits your team\./);
  assert.match(markdown, /## Plans/);
  assert.match(markdown, /- Starter: \$9 per month/);
  assert.match(markdown, /- Pro: \$29 per month/);
  assert.match(markdown, /\[Start trial\]\(https:\/\/example.com\/signup\)/);
  assert.doesNotMatch(markdown, /Navigation/);
  assert.doesNotMatch(markdown, /Copyright/);
  assert.doesNotMatch(markdown, /window\.noise/);
});

test("converts simple HTML tables to Markdown tables", () => {
  const html = `
    <html>
      <head><title>Limits</title></head>
      <body>
        <main>
          <table>
            <tr><th>Plan</th><th>Seats</th></tr>
            <tr><td>Starter</td><td>3</td></tr>
            <tr><td>Pro</td><td>25</td></tr>
          </table>
        </main>
      </body>
    </html>
  `;

  const markdown = extractMarkdown({
    html,
    url: "https://example.com/limits",
    generatedAt: "2026-06-03T00:00:00.000Z"
  });

  assert.match(markdown, /\| Plan \| Seats \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /\| Starter \| 3 \|/);
});
