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

test("includes useful JSON-LD metadata before dropping scripts", () => {
  const html = `
    <html>
      <head>
        <title>Features</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                "name": "FinalBit",
                "url": "https://www.finalbitai.com",
                "description": "AI filmmaking platform."
              },
              {
                "@type": "SoftwareApplication",
                "name": "FinalBit",
                "applicationCategory": "MultimediaApplication",
                "operatingSystem": "Web",
                "description": "All-in-one AI filmmaking platform.",
                "featureList": [
                  "AI screenwriting and screenplay formatting",
                  "AI storyboarding"
                ],
                "offers": {
                  "@type": "Offer",
                  "url": "https://www.finalbitai.com/pricing"
                }
              }
            ]
          }
        </script>
      </head>
      <body><main><h1>Features</h1></main></body>
    </html>
  `;

  const markdown = extractMarkdown({
    html,
    url: "https://www.finalbitai.com/features",
    generatedAt: "2026-06-03T00:00:00.000Z"
  });

  assert.match(markdown, /## Structured Data/);
  assert.match(markdown, /### Organization/);
  assert.match(markdown, /Name: FinalBit/);
  assert.match(markdown, /Description: AI filmmaking platform\./);
  assert.match(markdown, /### SoftwareApplication/);
  assert.match(markdown, /Category: MultimediaApplication/);
  assert.match(markdown, /Operating system: Web/);
  assert.match(markdown, /Features:\n- AI screenwriting and screenplay formatting\n- AI storyboarding/);
  assert.match(markdown, /Offer: https:\/\/www\.finalbitai\.com\/pricing/);
});

test("formats block links without collapsing card content", () => {
  const html = `
    <html>
      <head><title>Features</title></head>
      <body>
        <main>
          <a href="/features/coverage" aria-label="Explore AI Script Coverage">
            <div>
              <h3>AI Script Coverage</h3>
              <p>Analyze screenplays for story, characters, and production feasibility.</p>
            </div>
            <div><span>Explore Feature</span></div>
          </a>
        </main>
      </body>
    </html>
  `;

  const markdown = extractMarkdown({
    html,
    url: "https://www.finalbitai.com/features",
    generatedAt: "2026-06-03T00:00:00.000Z"
  });

  assert.match(markdown, /### AI Script Coverage/);
  assert.match(markdown, /Analyze screenplays for story, characters, and production feasibility\./);
  assert.match(markdown, /\[Explore Feature\]\(https:\/\/www\.finalbitai\.com\/features\/coverage\)/);
  assert.doesNotMatch(markdown, /AI Script CoverageAnalyze screenplays/);
});
