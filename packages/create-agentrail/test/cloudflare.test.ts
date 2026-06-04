import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureKvNamespace, parseKvNamespaceCreateId } from "../src/cloudflare.js";

test("reuses an existing KV namespace when AGENTRAIL_RESOURCES is already present", async () => {
  const calls: string[] = [];

  const result = await ensureKvNamespace({
    binding: "AGENTRAIL_RESOURCES",
    runner: async (_command, args) => {
      calls.push(args.join(" "));
      return {
        exitCode: 0,
        stdout: JSON.stringify([{ id: "existing-id", title: "AGENTRAIL_RESOURCES" }]),
        stderr: ""
      };
    }
  });

  assert.deepEqual(result, {
    binding: "AGENTRAIL_RESOURCES",
    id: "existing-id",
    created: false
  });
  assert.deepEqual(calls, ["wrangler kv namespace list --json"]);
});

test("creates a KV namespace when no matching namespace exists", async () => {
  const calls: string[] = [];

  const result = await ensureKvNamespace({
    binding: "AGENTRAIL_RESOURCES",
    runner: async (_command, args) => {
      calls.push(args.join(" "));
      if (args.includes("list")) {
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }
      return { exitCode: 0, stdout: JSON.stringify({ id: "created-id" }), stderr: "" };
    }
  });

  assert.deepEqual(result, {
    binding: "AGENTRAIL_RESOURCES",
    id: "created-id",
    created: true
  });
  assert.deepEqual(calls, [
    "wrangler kv namespace list --json",
    "wrangler kv namespace create AGENTRAIL_RESOURCES --json"
  ]);
});

test("parses namespace ids from JSON and Wrangler text output", () => {
  assert.equal(parseKvNamespaceCreateId(JSON.stringify({ id: "json-id" })), "json-id");
  assert.equal(parseKvNamespaceCreateId("id = \"text-id\""), "text-id");
  assert.equal(parseKvNamespaceCreateId("Created namespace with id: colon-id"), "colon-id");
});
