/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Stdio entrypoint for the Boosthis React Native MCP server.
 *
 * Run with:  `pnpm --filter @workspace/boosthis-runtime-rn run mcp`
 * Or wire into Claude Desktop / Cursor / Replit AI MCP config:
 *   { "command": "pnpm",
 *     "args": ["--filter", "@workspace/boosthis-runtime-rn", "run", "mcp"] }
 * (run `… run mcp-config` to print a ready-to-paste config block.)
 *
 * Reads newline-delimited JSON-RPC 2.0 from stdin, writes responses to
 * stdout. All logs MUST go to stderr — stdout is the transport. Mirrors
 * `lib/boosthis-runtime-node/src/mcp-stdio.ts`.
 *
 * NOTE on `process`: this RN package intentionally declares a narrow global
 * `process` (only `env`) for on-device code, and excludes @types/node globals
 * (`types: []`). This file only ever runs under Node via tsx, so we reach the
 * real Node process through a typed `globalThis` cast rather than importing
 * `node:process` (whose `export = process` would resolve to the narrow global).
 */

import { handleRequest, enableFilesystemVerify } from "./mcp";
import { configureLiveData, isLiveDataConfigured } from "./liveData";

// Filesystem verify (boosthis.verify_kit) is available ONLY on the local stdio
// server — it runs inside the consumer's project and can read the vendored kit
// files. The hosted HTTP route reuses handleRequest but never enables this, so
// it cannot verify (and never leaks) the server's own monorepo checkout.
enableFilesystemVerify();

interface NodeWritable {
  write(s: string): boolean;
}
interface NodeStdin {
  setEncoding(enc: string): void;
  on(event: "data", cb: (chunk: string) => void): void;
  on(event: "end", cb: () => void): void;
}
interface NodeProcess {
  stdin: NodeStdin;
  stdout: NodeWritable;
  stderr: NodeWritable;
  exit(code?: number): never;
}
const proc = (globalThis as unknown as { process: NodeProcess }).process;

// Live-data wiring. ONLY the stdio entrypoint reads env and injects the read
// credentials for ONE install (see liveData.ts for why config is injected here
// rather than read inside the shared tool handler — the hosted route reuses the
// same handler and must never serve one install's data to every key holder).
// Names mirror community.ts: `||` (not `??`) so a blank var falls through.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
configureLiveData({
  installId: env.BOOSTHIS_INSTALL_ID || env.BOOSTEN_INSTALL_ID,
  token: env.BOOSTHIS_READ_TOKEN || env.BOOSTEN_READ_TOKEN,
  baseUrl: env.BOOSTHIS_ENDPOINT || env.BOOSTEN_ENDPOINT,
});

proc.stderr.write(
  "boosthis-rn MCP server starting. Serves the rule book, the code matcher, " +
    "and the learning-loop write tools. " +
    (isLiveDataConfigured()
      ? "Live per-screen data: ON (read credentials configured — the four " +
        "live-data tools read this install's server-side summary)."
      : "Live per-screen data: OFF (set BOOSTHIS_INSTALL_ID + " +
        "BOOSTHIS_READ_TOKEN, copied from the in-app Boosten dashboard with " +
        "full-details telemetry on, to let the live-data tools read it).") +
    "\n",
);

let buffer = "";
// Hard cap on a single unframed line. MCP requests are small JSON objects;
// the cap stops a stuck pipe or upstream agent from pinning unbounded memory
// while we wait for a newline that may never arrive.
const MAX_LINE_BYTES = 1 << 20; // 1 MiB

// handleRequest is async (get_rule fetches its fix from the server per-rule),
// so requests are dispatched through a serial promise chain. Buffer slicing
// stays synchronous in the 'data' handler to avoid races; only the per-line
// parse + dispatch is deferred, and the chain preserves response ordering.
let chain: Promise<void> = Promise.resolve();
function dispatch(line: string): void {
  chain = chain
    .then(async () => {
      if (line.length > MAX_LINE_BYTES) {
        proc.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: line exceeds 1MiB cap" } }) + "\n",
        );
        return;
      }
      let req: unknown;
      try {
        req = JSON.parse(line);
      } catch {
        // JSON-RPC 2.0 §5.1 — malformed JSON must surface as a Parse error
        // response with id: null, not be silently dropped.
        proc.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n",
        );
        return;
      }
      const resp = await handleRequest(req);
      if (resp !== null) proc.stdout.write(JSON.stringify(resp) + "\n");
    })
    // One bad line must never wedge the chain for every later request.
    .catch(() => {});
}

proc.stdin.setEncoding("utf8");
proc.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  let nl: number;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    dispatch(line);
  }
  // Same cap applies to an unflushed in-progress line — drop the buffer rather
  // than letting a single message of any size eat the heap.
  if (buffer.length > MAX_LINE_BYTES) {
    proc.stderr.write(
      `boosthis-rn MCP: dropping ${buffer.length}-byte unframed input (exceeds 1MiB cap)\n`,
    );
    buffer = "";
  }
});

proc.stdin.on("end", () => proc.exit(0));
