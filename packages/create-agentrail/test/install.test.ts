import { test } from "node:test";
import assert from "node:assert/strict";
import { installProjectDependencies } from "../src/install.js";

test("runs npm install in the generated project directory", async () => {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

  const result = await installProjectDependencies({
    targetDir: "/tmp/demo-agentrail",
    runner: async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
      return { exitCode: 0, stdout: "installed", stderr: "" };
    }
  });

  assert.deepEqual(result, {
    installed: true
  });
  assert.deepEqual(calls, [
    {
      command: "npm",
      args: ["install"],
      cwd: "/tmp/demo-agentrail"
    }
  ]);
});

test("returns failed install state without throwing", async () => {
  const result = await installProjectDependencies({
    targetDir: "/tmp/demo-agentrail",
    runner: async () => ({ exitCode: 1, stdout: "", stderr: "registry unavailable" })
  });

  assert.deepEqual(result, {
    installed: false,
    error: "Unable to install dependencies:\nregistry unavailable"
  });
});
