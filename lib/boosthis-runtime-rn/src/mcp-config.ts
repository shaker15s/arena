/*
 * BOOSTHIS-OWNED — DO NOT EDIT.
 * This file is vendored from the Boosthis kit. Editing it makes the kit report
 * a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
 * the next entitlement check-in. To change Boosthis, update it via the hosted
 * Boosthis MCP server instead of editing here.
 */
/** Print a ready-to-paste MCP client config for the React Native rule server.
 *
 * Mirrors the Python CLI's `boosthis mcp-config` output so connecting the
 * plugin is copy-paste, not hand-assembly. Run with:
 *   `pnpm --filter @workspace/boosthis-runtime-rn run mcp-config`
 *
 * See `mcp-stdio.ts` for why `process` is reached via a `globalThis` cast
 * instead of a `node:process` import.
 */

const proc = (globalThis as unknown as { process: { stdout: { write(s: string): boolean } } }).process;

const config = {
  mcpServers: {
    "boosthis-rn": {
      command: "pnpm",
      args: ["--filter", "@workspace/boosthis-runtime-rn", "run", "mcp"],
    },
  },
};

proc.stdout.write(
  "# Paste this into your AI tool's MCP config\n" +
    "# (Claude Desktop: claude_desktop_config.json · Cursor: .cursor/mcp.json · Replit AI: MCP settings)\n\n" +
    JSON.stringify(config, null, 2) +
    "\n\n" +
    "# Optional — let the AI read this app's LIVE per-screen meter (the four\n" +
    "# live-data tools: session_summary / recent_samples / budgets /\n" +
    "# what_should_i_look_at_next). Add an \"env\" block to the boosthis-rn server\n" +
    "# above with credentials copied from the in-app dashboard's dev-only\n" +
    "# \"MCP read access\" card (only visible with full-details telemetry on):\n" +
    "#\n" +
    "#   \"boosthis-rn\": {\n" +
    "#     \"command\": \"pnpm\",\n" +
    "#     \"args\": [\"--filter\", \"@workspace/boosthis-runtime-rn\", \"run\", \"mcp\"],\n" +
    "#     \"env\": {\n" +
    "#       \"BOOSTHIS_INSTALL_ID\": \"<install id from the dashboard>\",\n" +
    "#       \"BOOSTHIS_READ_TOKEN\": \"<read token from the dashboard>\"\n" +
    "#     }\n" +
    "#   }\n" +
    "#\n" +
    "# Without these the live-data tools return a note pointing at the in-app\n" +
    "# dashboard. The hosted/shared MCP endpoint never serves live data.\n" +
    "# (Optional: set BOOSTHIS_ENDPOINT to point at a self-hosted server.)\n",
);
