<!--
  BOOSTHIS-OWNED — DO NOT EDIT.
  This file is vendored from the Boosthis kit. Editing it makes the kit report
  a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
  the next entitlement check-in. To change Boosthis, update it via the hosted
  Boosthis MCP server instead of editing here.
-->
# Boosthis — Quickstart

Boosthis is a paid performance product with open signup. It is **not** on npm or PyPI — you download this kit from your project key's Setup page and unpack it into your own project. A project key issued from your account dashboard is what the kit needs before it can register, report, or fetch fixes; without one it measures on-device only.

## What you already have

You are reading this from inside the kit you downloaded (the **Download** button on your key's Setup page, or the one-line command next to it). Unpacked, it leaves:

- `lib/boosthis-runtime-rn/` — the React Native / Expo runtime
- `lib/boosthis-checklist/` — the rule data it reads
- `./boosthis` — the one-time helper used below
- `INSTALL.md`, `QUICKSTART.md`, `SECURITY.md`, `PRIVACY.md` and the licence

Nothing else is fetched.

## Where it goes

**Plain app** (one `package.json`, no `pnpm-workspace.yaml` and no `"workspaces"` field): unpack beside that `package.json` — it is both the app folder and the repository root.

**Workspace app** (the repository root holds `pnpm-workspace.yaml`, or a root `package.json` with `"workspaces"`, and the app lives in a sub-folder): unpack at the **repository root**, not in the app's sub-folder, so the workspace globs can see `lib/*`.

INSTALL.md section 1 states this in full; this is the short form of the same answer.

## React Native / Expo project

**Plain app** — point that same `package.json` at the two unpacked folders:

```json
"dependencies": {
  "@workspace/boosthis-runtime-rn": "file:./lib/boosthis-runtime-rn",
  "boosthis-checklist": "file:./lib/boosthis-checklist"
}
```

**Workspace app** — put `"@workspace/boosthis-runtime-rn": "workspace:*"` in the **RN app's own** `package.json` (the one in its sub-folder), never the root one, and make sure the root `pnpm-workspace.yaml` includes `lib/*`.

Then install (`npm install` / `pnpm install` / `yarn`) from the repository root and run the helper from there:

```bash
./boosthis init-rn . --project-key <your project key>
```

This will:

1. Detect that your project is React Native or Expo.
2. Write a `boosthis.config.json` with sensible score budgets, and store your key
   in this runtime's own slot — if the codebase already reports under another
   key (a back end, a website), that key is left untouched and the phone app
   becomes its own project.
3. Print the exact snippet to paste into your **root layout** (FID sampler + long-session diagnostic + boot marks).
4. Print the snippet to paste into **any screen you want measured** (`useBoosthis("home")`).

To verify the integration later:

```bash
./boosthis doctor-rn .
```

To check the app is wired to the project key you expect (it fails loudly if it
is not, and never prints the key itself):

```bash
./boosthis verify-rn . --project-key <your project key>
```

## Python project

The Python kit is a **separate download** — pick **Python** on the same Setup page, unpack it in your project, and install it:

```bash
pip install -e ./lib/boosthis-py
```

Then in your code:

```python
from boosthis import track_perf, perf

@track_perf("orders.get")
def get_order(order_id: int):
    ...

with perf("db.heavy_query"):
    rows = session.execute(query).all()
```

**Optional — auto-mount the dashboard into your FastAPI / Flask / Starlette app:**

```bash
boosthis init --patch path/to/your_app.py            # actually patch
boosthis init --patch path/to/your_app.py --dry-run  # preview only
```

This inserts `import boosthis` + `boosthis.mount(app)` after the framework constructor and writes a `.bak` backup. Refuses (safely) if the file already mounts Boosthis, if there's no constructor, or if multiple constructor candidates are ambiguous. After it runs, open `http://<your-app>/_boosthis/` in a browser.

Or do it by hand — it's still one line:

```python
import boosthis
boosthis.mount(app)  # right after `app = FastAPI(...)` / `Flask(__name__)` / `Starlette(...)`
```

Or skip mounting entirely and run `boosthis serve` for a localhost-only dashboard.

To let AI agents read live perf state via MCP:

```bash
boosthis mcp     # stdio JSON-RPC 2.0
# or
boosthis serve   # HTTP on 127.0.0.1:7787
```

## Disable Boosthis globally

Set `BOOSTHIS_DISABLED=1` in your environment. Every hook, every transmit, every recorded event becomes a no-op — no code change required. Useful for CI runs and sensitive builds.

## Dashboard access control

`boosthis.mount(app)` serves the dashboard at `/_boosthis/` on **localhost only** by default — any non-loopback request gets a 403. This protects production deployments from accidentally exposing route timings and function qualnames.

If you're running inside a container behind an authenticated reverse proxy (so the host app already enforces auth), opt in to remote access:

```bash
BOOSTHIS_MOUNT_ALLOW_REMOTE=1
```

Accepts `1`, `true`, `yes`, `on` (case-insensitive). When in doubt, leave it unset — `boosthis serve` (localhost-only, separate process) is always safe.

## Privacy

- For a general (unregistered) install, telemetry is **off** and nothing leaves the device or process. For a **registered app**, only the always-on privacy-safe issue + fix signals are sent automatically; the optional full per-route samples are still off unless you explicitly opt in. Only `forget` or the kill-switch `BOOSTHIS_DISABLED=1` stops the always-on signals. See `PRIVACY.md` for the full two-channel model.
- An 83-entry PII denylist guards every outbound payload — the same list, byte-for-byte, in the React Native and Python kits.
- See `PRIVACY.md` for the full posture and `SECURITY.md` for the security guarantees.

## Verify everything works

```bash
./boosthis doctor-rn .    # wiring, duplicate React Native copies, config sanity
```

Then run the app once: it appears under **Your Projects** on your Boosthis dashboard.
