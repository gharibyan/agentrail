# AgentRail Cloudflare Basic Example

This example uses the smallest useful Cloudflare setup:

- one Worker route
- one Cron Trigger
- one KV namespace named `AGENTRAIL_RESOURCES`

The `create-agentrail` CLI tries to create or reuse this KV namespace automatically. If that succeeds, `wrangler.jsonc` already contains the correct namespace id.

Use the root `wrangler.example.jsonc` as the starting point:

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

If `wrangler.jsonc` still contains `replace-with-agentrail-resources-kv-id`, create or find the KV namespace:

```bash
npx wrangler login
npx wrangler kv namespace list --json
npx wrangler kv namespace create AGENTRAIL_RESOURCES
```

Copy the resulting id into:

```json
{
  "binding": "AGENTRAIL_RESOURCES",
  "id": "your-kv-namespace-id"
}
```

Then update the route and origin. The scaffold CLI installs dependencies automatically unless you used `--skip-install`; if needed, run `npm install` before deploying:

```bash
npm install
npm run deploy
```

This example deploys a Cron Trigger. If the Cloudflare account has not deployed Workers before, open Workers & Pages in the Cloudflare dashboard once before deploying. That initializes the required `workers.dev` subdomain. If deploy fails with `code: 10063`, do that dashboard step and rerun `npm run deploy`.

After the first cron run, known AI agents receive Markdown for pages that have ready generated resources. Pages that have not been crawled yet continue to serve the original site.
