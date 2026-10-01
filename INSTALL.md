<!--
  BOOSTHIS-OWNED — DO NOT EDIT.
  This file is vendored from the Boosthis kit. Editing it makes the kit report
  a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
  the next entitlement check-in. To change Boosthis, update it via the hosted
  Boosthis MCP server instead of editing here.
-->
# Boosthis RN Kit — drop-in install

This zip contains the React Native side of **Boosthis** — a private cross-runtime
performance toolkit. It includes the RN runtime, the 102-rule performance
checklist, the `./boosthis` CLI, and the **MCP server** so your AI assistant can
read Boosthis's rules and per-rule fixes on demand.

Boosthis is **not on npm or PyPI** — it is private. This kit is how an outside
app receives it.

**Privacy:** every package is `private`. With **no project key** the runtime is
fully on-device — nothing ever leaves. When a **project key is configured**, the
kit auto-registers and begins reporting. **Sharing is ON by default for a new
project**, so a registered install reports performance readings from your end
users' own devices from its first launch; you can turn it off any time from the
project's dashboard, which takes effect on the next check-in with no rebuild and
no store release. The on-device PII denylist runs on every payload, and
`BOOSTHIS_DISABLED=1` silences the whole runtime. See `PRIVACY.md`,
`DISCLAIMER.md`, `SECURITY.md`, and `TERMS.md`.

---


## What this kit adds to your app

Decide this before you ship, not after. Two kinds of thing arrive with
an install: something your users can see, and addresses your app starts
answering.

### What your users see

- A floating bubble over the app's own screens, opening the same panel.
- Where: Inside the app itself, on the device.
- The floating bubble is on by default in every environment, including production. BOOSTHIS_BUBBLE set to 0 hides it and the kit carries on measuring; BOOSTHIS_DISABLED stops the kit altogether. Each name is read from the environment where this runtime has one, and otherwise from a value of the same name on the host.

### What your app starts answering

- Nothing. A phone app serves nothing. The kit adds no address a stranger could request.

The same list for every runtime, alongside what each address returns, is
published at https://www.boosthis.com/docs/what-boosthis-adds.

## App Store & Google Play: what you must declare

Boosthis measures **your end users' own devices**, so what it sends is data
**your** app collects and declares under **your** store listings. Only you can
update those listings, so read this before you ship.

With **no project key** nothing leaves the device and there is nothing extra to
declare. Everything below applies once a project key is configured.

**Always sent, whatever the sharing switch says** (registration and the
entitlement check-in): a Boosthis-generated per-install identifier (NOT the
advertising identifier / IDFA / AAID and not a device serial), your app's name,
and the kit version.

**Additionally sent while sharing is ON:** code-defined route/screen labels with
their timings, observable device meters (frame smoothness, JS startup, memory
and image weight, navigation dead time, device tier, dev posture), and crash
*signatures* — never their text.

**Never sent, in any mode:** user content or input, screen text, view contents,
request or response bodies, query strings, headers, cookies, log or error
message text, source code, diffs, precise location, contacts, photos,
advertising identifiers, or any account or personal identity. Boosthis does not
track users across apps or companies and shares nothing with data brokers.

**Apple — App Store Connect → App Privacy.** Declare at minimum **Diagnostics →
Performance Data** (add **Crash Data** if crash reporting is on) and
**Identifiers → Device ID** for the per-install identifier — purpose *App
Functionality* and/or *Analytics*, **not** linked to the user's identity,
**not** used for tracking.

**Google — Play Console → Data safety.** Declare at minimum **App info and
performance → Other app performance data** (add **Crash logs** if crash
reporting is on) and **Device or other IDs**, purpose *App functionality* and/or
*Analytics*, not shared with third parties. Answer **yes** to "data is encrypted
in transit" (all traffic is HTTPS) and **yes** to "users can request that their
data be deleted" — `client.forget()` and the project dashboard both delete an
install's data.

These are the entries this kit itself causes; your full answers still depend on
everything else your app collects. Check Apple's and Google's current guidance
before you submit.

---

## You are an AI agent reading this

You are an AI agent (Replit AI, Cursor, Claude, etc.) inside a Replit project
that contains a **React Native / Expo** app. The user wants you to wire Boosthis
into their app. Follow the steps below in order. Integration into *this* app is
your job; questions about Boosthis itself belong to the Boosthis maintainer.

There are two independent things you can set up. Do step 1–6 for in-app
performance measurement, and step 7 for the **MCP** (so you, the AI, can fetch
Boosthis's prescriptive fixes). They work great together but neither requires
the other.

---

### 1. Unpack the kit — where the files go

**This is the one statement of where kit files belong; QUICKSTART.md repeats it
in short and adds nothing to it.** Look first at whether the repository is a
workspace, because the answer differs.

**Plain app** — one `package.json`, no `pnpm-workspace.yaml` and no
`"workspaces"` field. The repository root and the app folder are the same
folder. Unpack there, beside that `package.json`.

**Workspace app** — the repository root holds a `pnpm-workspace.yaml`, or a
root `package.json` with a `"workspaces"` field, and the RN app lives in its
own sub-folder (`apps/mobile/`, `packages/app/`, …). Unpack at the
**repository root** — the folder with `pnpm-workspace.yaml` — **not** in the
app's sub-folder. The workspace globs have to be able to see `lib/*`, and they
are resolved from the root.

In both cases you end up with `lib/boosthis-runtime-rn/`,
`lib/boosthis-checklist/` and `./boosthis` at that root:

```bash
cd <the folder chosen above>
unzip boosthis-rn-kit.zip -d /tmp/boosthis-rn-kit       # or: tar -xzf boosthis-rn-kit.tar.gz -C /tmp
mkdir -p lib
cp -r /tmp/boosthis-rn-kit/boosthis-rn-kit/lib/boosthis-runtime-rn lib/
cp -r /tmp/boosthis-rn-kit/boosthis-rn-kit/lib/boosthis-checklist  lib/
cp    /tmp/boosthis-rn-kit/boosthis-rn-kit/boosthis ./
chmod +x ./boosthis
```

### 2. Make the runtime resolvable

Which `package.json` gets the dependency lines follows from step 1.

**Plain app** — the same `package.json` the kit was unpacked beside. Use local
path deps:

```json
"dependencies": {
  "@workspace/boosthis-runtime-rn": "file:./lib/boosthis-runtime-rn",
  "boosthis-checklist": "file:./lib/boosthis-checklist"
}
```

**Workspace app** — the **RN app's own** `package.json` (the one in
`apps/mobile/` or wherever the app code lives), never the root one. Use the
workspace protocol, and make sure `pnpm-workspace.yaml` at the root includes
`lib/*`:

```json
"dependencies": {
  "@workspace/boosthis-runtime-rn": "workspace:*"
}
```

Then install (`pnpm install` or `npm install`) from the repository root.

> Troubleshooting: the runtime's own `package.json` lists
> `"boosthis-checklist": "workspace:*"`. If your non-monorepo install errors on
> that `workspace:*`, change it inside `lib/boosthis-runtime-rn/package.json` to
> `"boosthis-checklist": "file:../boosthis-checklist"` and reinstall.

### 3. Scaffold the integration

```bash
./boosthis init-rn .
```

This writes `boosthis.config.json` with sensible TTI / FID / FFI budgets and
prints the snippets to paste. To wire a project key at the same time (see step
7 for how to get one), pass it:

```bash
./boosthis init-rn . --project-key bk_xxxxxxxx
```

That stores the key in `boosthis.config.json` under this runtime's own slot,
`ingest.projectKeys.rn` — and in the shared `ingest.inviteKey` too when the
codebase does not already have one.

#### A codebase can hold more than one project

If this codebase already reports to Boosthis under another key (a back end, a
website), **that key is left exactly as it is**. React Native gets its own slot,
so the phone app registers as its own project instead of silently joining the
existing one. Nothing is ever rotated or replaced.

If this codebase already reports under another project key, set `BOOSTHIS_PROJECT_KEY_RN`.

The key this app sends is resolved in this order — the first one that exists
wins:

1. `globalThis.__BOOSTHIS_PROJECT_KEY_RN__`, set before the kit is imported —
   for a build that can set no environment variable at all
2. `EXPO_PUBLIC_BOOSTHIS_PROJECT_KEY_RN` (Expo) or `BOOSTHIS_PROJECT_KEY_RN`
3. the key passed to `enableTelemetry({ inviteKey })` in your code
4. `ingest.projectKeys.rn` in `boosthis.config.json`
5. `ingest.inviteKey` in `boosthis.config.json` (the shared key)

The environment variable deliberately outranks the key in your code: it is the
one lever that moves an app onto the right project **without editing the app's
source**. When it replaces a different key, the kit says so once at startup.
There is no shared `BOOSTHIS_PROJECT_KEY` — inheriting one is exactly the
mix-up this ordering prevents.

To check which key an app will actually send (and fail loudly if it is the
wrong one):

```bash
./boosthis verify . --project-key bk_xxxxxxxx
```

It prints the same short fingerprint the dashboard shows next to your key, and
never prints the key itself.

### 4. Paste the snippets

- **Root layout** (`app/_layout.tsx` for Expo Router, or `App.tsx` for bare RN):
  paste the `useFidSampler()` + `useLongSessionDiagnostic()` calls inside the
  root component.
- **Screens, automatically:** mount `<BoosthisNavigationObserver
  container={navigationRef} />` once at the app root — or hand it the current
  route with `<BoosthisNavigationObserver route={usePathname()} />` — and every
  screen change measures itself. No per-screen code.
- **Each screen the observer cannot see:** a modal, a drawer, a wizard step —
  anything that never changes route — is still yours to measure: add
  `useBoosthis("screen-name")` near the top of the component. (Use
  `usePerfTracker("screen-name")` if you only want mount timing.) A screen that
  has both is measured **once**, by your own call — the observer stands down for
  it rather than filing a second reading beside it.
- **Neither?** With no observer mounted and no hook in any screen, nothing
  per-screen is measured — app-wide readings still arrive, and the in-app panel
  says so in as many words rather than leaving you guessing.

### 5. Verify

#### Is Boosthis running? Read the badge, then the startup line

Boosthis draws its badge the moment it starts — before it reads the project key
and before it tries to register, and without waiting for a successful
connection. A badge therefore appears even when the key is wrong, and before
the app has ever checked in it opens on its own "Not registered yet" notice
rather than hiding.

- **Badge on the page = the kit is running.** Read the badge; it says what it is
  doing.
- **No badge at all = the kit was never switched on** — *once the launcher of
  step 6 is mounted*. Until that step there is nothing on screen to draw,
  which is why on a fresh install the startup line below, not the badge, is
  the first check. With the launcher mounted, only four other things stop a
  badge appearing: `BOOSTHIS_BUBBLE=0` (or the legacy `BOOSTHIS_NO_BUBBLE`);
  `visible={false}` on the launcher; `BOOSTHIS_DISABLED` or an inactive
  entitlement; and the kit never having started at all, which the startup line
  settles either way. A missing badge never means registration failed.

If no badge appears after step 6, the ordered path is: the startup line below;
those five causes; a real run rather than a preview (a browser or Expo-web
preview renders the same components, so it can show the launcher is mounted,
but it has no outbound network — registration and check-in cannot happen there
and the panel will say it is not registered however correct the install is);
and then ask Boosthis directly, which is the check that always answers — the
`connection_status` tool over the MCP connection, or `GET
https://www.boosthis.com/api/connection-status` with the project key. That
answer comes from Boosthis rather than from the app, so it works from a
restricted preview and from a project that has never been published.

The only Boosthis badge is the one this kit ships, and the only Boosthis mark
is the one shipped inside it. A hand-built floating button, a redrawn or
generated logo, a letter "B", an emoji or a lightning glyph is not Boosthis,
and presenting one as Boosthis says the install is working while the real
badge is still not on screen. If the shipped badge cannot be made to appear,
report that — with what Boosthis says about the install — rather than drawing
a replacement.

The kit also says one line the moment it starts, and that line is the anchor for
every diagnosis:

```
[boosthis] Boosthis starting: project key ...1a2b. Registering next.
```

No line means the kit never started, whatever anyone believes. It is never
silenced by a quiet mode, a privacy setting or a hidden badge.

**Step 1, before anything else: find that line.** Launch the app, read the Metro
console, and quote it back to the developer VERBATIM, including the four
characters of the key it names. Do not paraphrase it and do not report it from
memory. Until you have quoted it, do not offer ANY other explanation — not the
key, not the network, not a sandbox, not a preview pane.

**Step 2.**

```bash
./boosthis doctor-rn .
```

`doctor` checks the wiring AND lints the things that silently break a release
build: it flags a placeholder / dead `boosten.replit.app` / relative / credential
-bearing endpoint in `boosthis.config.json` or your `EXPO_PUBLIC_*` URLs, and — on
an Expo app — **warns if `enableTelemetry()` is called without an `expo/fetch`
transport** (the reused-socket sign-in bug, see below). Fix every `✗`/`!` it
prints before shipping.

Run the app, navigate a few screens, and look for lines like
`[boosthis] home · mount 142ms · good` in the Metro console — that's a live
sample being recorded.

**Is the device actually reaching Boosthis?** Call the built-in self-test from a
debug button (or a one-off effect). It probes `GET /healthz` through the exact
transport your telemetry uses — and, when you wired a custom `fetchImpl`, through
the bare global too, so you can see *"my wired transport works but the global
doesn't"* (or vice-versa) at a glance. It never throws and returns a one-line
`summary` you can drop straight into an `Alert()`:

```tsx
import { runNetworkSelfTest } from "@workspace/boosthis-runtime-rn";

const result = await runNetworkSelfTest(); // uses your active telemetry transport
Alert.alert("Boosthis connectivity", result.summary);
// result: { ok, endpoint, probes: [{ transport, ok, status, reason }], summary }
```

### 6. Add the floating bubble near the app root

Mount the launcher once near the app root, after the navigator. Its small
draggable bubble opens the drop-in dashboard (score gauge + breakdown + budgets)
in a modal. It uses pure React Native with no extra dependencies.

```tsx
import { BoosthisLauncher } from "@workspace/boosthis-runtime-rn";

// ...inside your root layout, after the navigator:
<BoosthisLauncher appName="Rival" subtitle="React Native" />
```

The launcher is visible by default in every build, including release builds.
To hide it, set `BOOSTHIS_BUBBLE=0` as an environment/global directive or pass
`visible={false}`. The directive outranks the prop, and `BOOSTHIS_DISABLED`
always hides it.

Optional launcher props: `appName`, `subtitle`, `visible`, `corner` (default
`"top-right"`), `label`, `theme`.

**Extra:** if the app already has a Settings screen or tab bar, you may also add
a row/tab that opens `<BoosthisDashboard appName="Rival" />`. This is an
optional extra alongside the root launcher, not a replacement for it.

---

### 7. Connect the MCP server (so the AI can fetch fixes)

Boosthis ships an **MCP server** for React Native. It serves the 102-rule book,
a code matcher, and — for a registered app — the prescriptive **fix text** for
each rule, fetched **one rule at a time** from the maintainer's server. The fix
text is NOT bundled in this kit; it is fetched on demand over the network.

**7a. Get a project key.** Boosthis is a paid product with open signup; once you have an account you mint your own project keys from the account dashboard. Create a **`fix`-scoped** key: it can fetch fixes but cannot register installs or mint more keys, which is exactly what an MCP server should hold. The dashboard shows the raw key only once, so store it safely.

**7b. Generate the MCP client config:**

```bash
pnpm --filter @workspace/boosthis-runtime-rn run mcp-config
```

This prints a ready-to-paste block. Add the project key to its `env` so fixes
can be fetched. The final config looks like:

```json
{
  "mcpServers": {
    "boosthis-rn": {
      "command": "pnpm",
      "args": ["--filter", "@workspace/boosthis-runtime-rn", "run", "mcp"],
      "env": { "BOOSTHIS_INVITE_KEY": "bk_your_fix_scoped_key" }
    }
  }
}
```

> Plain (non-pnpm) Expo app? Run the server directly instead:
> `"command": "npx", "args": ["tsx", "lib/boosthis-runtime-rn/src/mcp-stdio.ts"]`
> with the same `env` block.

Paste it where your AI tool keeps MCP config (Replit AI: MCP settings · Cursor:
`.cursor/mcp.json` · Claude Desktop: `claude_desktop_config.json`), then restart
the tool.

**7c. Use it.** Once connected, the AI gets these tools: `list_rules`,
`get_rule` (returns the fix for one rule — needs the key + network),
`match_rules_for_code`, plus the learning-loop tools. Without a valid key,
`get_rule` still returns the rule id/title/when-to-apply plus a note that the
fix needs a connection and a registered app.

Note: live per-screen perf samples stay **on the device** — the MCP server does
not see them. For session summaries, open the in-app dashboard (step 6).

---

## Online reporting — automatic once a project key is configured

Boosthis is on-device only **until a project key is configured**. If you ran
`./boosthis init-rn . --project-key <key>` (step in the AI instructions), the kit
registers this app automatically and reports to the maintainer's dashboard. Use
the **same key** you put in your Boosthis MCP
connection — a `fix`-scoped key works (it can register this app and fetch fixes,
but cannot mint other keys, so it is safe to ship in the app). Registration is
wired in the root component. **For an Expo app,
pass `expo/fetch` as the transport** (the `fetchImpl` line below) — this is the
recommended default, not an advanced extra: RN's built-in XHR can silently drop a
response on a reused iOS socket, which makes in-app sign-in fail on release
iOS/Hermes builds, and `expo/fetch` (a WHATWG transport, Expo SDK 52+) does not.
Because **every** Boosthis call — telemetry, consent, AND sign-in / account-link —
flows through this one `fetchImpl`, wiring it here makes sign-in reliable out of
the box. A **bare React Native** app (no `expo` package) can't import
`expo/fetch`, so it omits that line and keeps the global `fetch`:

```tsx
import { fetch as expoFetch } from "expo/fetch"; // Expo SDK 52+ — robust transport (see note)
import boosthisConfig from "./boosthis.config.json";
import { enableTelemetry, resolveProjectKey } from "@workspace/boosthis-runtime-rn";

const client = enableTelemetry({
  installId,                                  // a stable per-install UUIDv4 you persist
  endpoint: "https://www.boosthis.com/api",
  inviteKey: resolveProjectKey(boosthisConfig), // this runtime's key (see "one project per runtime")
  fetchOptions: { fetchImpl: expoFetch },    // Expo: route every call (incl. sign-in) through expo/fetch
});
```

Set `installId` once when the project is first installed and never change it.
A new value does not repair a connection: it registers a second device under the same project and leaves the real one as a duplicate; fix the project key and use the dashboard's **Repair** instead.

**Keep the stored id even when the credentials beside it are gone.** Code that
reads back a saved id, finds no delete token next to it and mints a fresh one
to start clean is the quickest way to fill a dashboard with single-run
installs. The kit already repairs that case: it re-registers under the stored
id, and if the server answers that the row exists but this copy cannot prove
it owns it, the kit rotates ONCE to an identity the server links to the row it
replaces. Throwing the id away first pre-empts that repair and files an
unlinked install instead. If the store you keep it in can fail to write — a
keychain can — mirror the id into ordinary app storage and read both: an id
only one store holds is an identity your next launch may not have.

- **What it sends is decided by the project dashboard, and sharing is ON by
  default.** A registered install reports code-defined route/screen labels with
  their timings and the device meters listed in the declaration section above,
  plus anonymous issue signatures (rule kind, severity bucket, count bucket,
  occurrence count) and fix-resolution signals. Turn sharing off in the
  dashboard and it drops back to issue signatures alone on the next check-in —
  no rebuild.
- **Never sends, either way:** user content or input, screen text, request or
  response bodies, query strings, headers, cookies, log or error message text,
  source, or diffs. The on-device PII denylist runs on every payload.
- **Pre-contact opt-out (optional):** passing `issuesOnly: true` keeps the very
  first launch on issue signatures only, before the dashboard's answer arrives.
  It is not a veto — the dashboard decides from first contact onward.
- **No key, no reporting:** without a configured project key the app stays 100%
  on-device.
- **One app, one project — across relaunches, IF the app has device storage.**
  The kit stores the credentials the server issues for this install in
  `@react-native-async-storage/async-storage` and restores them on the next
  launch, so a restart re-registers as the SAME app instead of appearing as a
  new one. If you also wire `onTokenIssued` and pass the value back as
  `deleteToken`, your copy wins. `client.forget()` erases both.
- **That storage package is an OPTIONAL peer dependency — without it every
  relaunch is a new install.** An app that does not have it keeps running
  normally on an in-memory fallback, with no error and nothing in the logs. But
  nothing survives the process, so the next launch cannot prove it is the
  install already on file: it registers again under a fresh id. Your dashboard
  then fills with installs under one project key, each holding the measurements
  of a single run, and the install id and read token you copied out of the
  in-app panel stop working. Add
  `@react-native-async-storage/async-storage` and rebuild the app to fix it.
  The same thing happens if you hand `setPerfPlatform` a storage adapter of
  your own that declares `persistent: false` — there the fix belongs in that
  adapter, and adding the package changes nothing. The kit reports which store
  it landed on, so the dashboard, the connection health answer and the in-app
  Boosthis panel all say so; what they report is that the store does not
  persist, never which of the two put it there.
- **Leave anytime:** `client.forget()` erases the install and its signatures
  from the server; `BOOSTHIS_DISABLED=1` silences everything.

If the maintainer revokes your key, registration and fix-fetch stop working
immediately — that is expected.

---

## Network measurement (`autoWrapNetwork`) — on by default

The Network meter rates how long this app's own requests take and how they end
(ok / error / timeout / near-hang). It has always been report-only: you call
`recordNetworkAttempt` / `measureNetworkAttempt` and the kit sees a duration
and a coarse outcome, with **no field anywhere for a URL, host, path, status
or any request detail**. That contract is unchanged.

What is new is that you no longer have to write those calls at all. The kit
reports your app's attempts itself, with no setting to pass. To refuse it,
pass `autoWrapNetwork: false`:

```tsx
const client = enableTelemetry({
  installId,
  endpoint: "https://www.boosthis.com/api",
  inviteKey: resolveProjectKey(boosthisConfig),
  autoWrapNetwork: false,       // ← refuse: wrap none of this app's transports
});
```

An app that refuses it is not left with a meter that claims to be measuring:
the Network reading says it is switched off in this build, and
`recordNetworkAttempt` / `measureNetworkAttempt` keep working if you would
rather report your own calls.

It reports exactly the same two values the manual API accepts, and nothing
else is read off a request at any point.

- **Both global transports.** React Native's `fetch` runs on
  `XMLHttpRequest`, and a global `fetch` your app or a library replaces later
  bypasses XHR entirely. Both are wrapped, so an app is measured rather than
  half-measured.
- **A transport you import is handed over in one line.** `fetch` from
  `expo/fetch`, or a native SDK's own client, never touches either global, so
  nothing the kit installs on a global can see it. Wrap it once at the import
  site and those calls are measured on exactly the same terms:

  ```ts
  import { fetch as expoFetch } from "expo/fetch";
  import { wrapNetworkFetch } from "boosthis-runtime";

  export const fetch = wrapNetworkFetch(expoFetch); // use this in your app
  ```

- **Boosthis's own uploads are not your app's traffic.** The kit's consent,
  telemetry and snapshot calls go out through the same global `fetch`, and
  they are excluded: an app that makes no requests of its own stays at
  "nothing measured yet" no matter how long the kit runs.
- **A shim installed after us does not switch it off.** The kit re-asserts
  itself on its ordinary reporting cadence, so a global `fetch` your app (or a
  library) replaces later is wrapped again. It never assumes it is the only or
  the outermost wrapper.
- **Counted once — with `measureNetworkAttempt`.** A call you time yourself
  with `measureNetworkAttempt` is one attempt even when it goes out through a
  wrapped transport: the wrapper timed that request itself, so your own timer
  stands down for it and the `stallMs` you pass gives way to the threshold set
  once on `enableTelemetry`. It stands down only for a request the kit can be
  shown to have measured — the call you awaited was ours, or an automatic
  attempt began inside your window, settled with it and ended the same way.
  A different request that merely overlapped yours never silences it: on a
  transport the kit cannot reach, your own timer is the only reporter there
  is, and dropping it would show an absence as a measurement.
- **`recordNetworkAttempt` records exactly what you hand it.** It arrives
  after the fact as a duration and an outcome word, and nothing in those two
  values could say whether it is a call the wrapper has just timed or a
  second one on a transport we never saw — so it is *not* de-duplicated. Keep
  it for transports the kit cannot reach and have not been handed over with
  `wrapNetworkFetch`; reporting a call that already went out through the
  global `fetch` or `XMLHttpRequest` counts that call twice.
- **What we could not watch is reported, not hidden.** A transport that is
  present and cannot be wrapped is counted and shown as a gap in coverage,
  rather than quietly reducing to a measured zero.
- **Refusable, and reversible.** Pass `autoWrapNetwork: false` and nothing of
  yours is wrapped; `recordNetworkAttempt` / `measureNetworkAttempt` work
  exactly as before, and the meter says it is switched off in this build
  rather than claiming to measure. `client.forget()` stands the wrappers down.

Your app's behaviour is unchanged either way: every wrapped call returns the
inner call's exact value and rethrows its exact error.

---

## Custom transport (advanced — `fetchImpl`)

Boosthis uses the host app's own networking. **Expo apps should pass `expo/fetch`
as shown in the section above — that is the prescribed default, already wired by
`./boosthis init-rn` and the AI setup steps.** This section documents the
underlying transport contract and covers OTHER custom transports. By default
(bare RN, no `fetchImpl`) Boosthis resolves the global `fetch` (bound to
`globalThis`). If your app routes traffic through a custom transport —
`expo/fetch`, a wrapped `XMLHttpRequest`, or a proxy that adds auth/retries —
pass it once and **every** Boosthis call (telemetry, sign-in, account-link) goes
through it:

```tsx
const client = enableTelemetry({
  installId,
  endpoint: "https://www.boosthis.com/api",
  inviteKey: resolveProjectKey(boosthisConfig),
  issuesOnly: true,
  fetchOptions: { fetchImpl: myFetch },   // ← your transport
});
```

Your `fetchImpl` MUST behave like a minimal `fetch`, or in-app sign-in can fail
silently (this is the class of bug that bit the Rival iOS/Hermes build):

1. **Throw on failure.** Reject on a dropped / reset / half-open socket, a DNS
   error, or your own timeout. **Never resolve a synthetic "failure" object** —
   the kit retries only on a *throw*, so a swallowed failure disables
   backoff-retry. A raw `XMLHttpRequest` shim must reject on `onerror` /
   `ontimeout` / `onabort`.
2. **Read status only when complete.** For an XHR shim, resolve at
   `readyState === 4` (DONE) — never an earlier readyState, so a partial
   response can't be mistaken for a result.
3. **Time out below the kit's ~8s per-attempt race.** Set your own timer
   (e.g. `xhr.timeout = 6500`) so your shim abandons a stalled socket first and
   the kit's retry gets a fresh connection. Do **not** use an AbortController
   `signal` — some RN runtimes throw when fetch is handed one.
4. **Resolve a minimal Response.** At least
   `{ status, ok, json(): Promise<any>, text(): Promise<string> }`. Boosthis
   duck-types any object with a numeric `status` as a Response; anything less
   makes `res.status` / `res.json()` throw downstream.

**The kit already calls your `fetchImpl` with a Hermes-safe shape**, so you do
*not* have to defend against the landmine that broke the Rival build: Boosthis
normalizes request headers to an **array of `[name, value]` string tuples**
(never a `Headers` instance) and always sends a `string` (or `undefined`) body.
That matters because a bare `expo/fetch` on a release **Hermes / New Architecture**
bundle runs `headers instanceof Headers` internally, and `Headers` is `undefined`
there — the `instanceof` throws synchronously and the request never leaves. By
handing every transport the tuple shape, the kit sidesteps that for `expo/fetch`
and for your own shim alike — so your `fetchImpl` can read `init.headers` as a
plain `[k, v][]` and never needs to branch on `instanceof Headers` itself.

No custom transport? Skip this — Boosthis uses the global `fetch`, and the same
Hermes-safe tuple shaping still applies.

---

## What this kit does NOT include

- The Boosthis **standalone mobile dashboard app** (the maintainer's own viewer)
  — you don't need it; the drop-in `BoosthisDashboard` (step 6) is the host
  app's viewer.
- The **Node.js** runtime (`@workspace/boosthis-runtime-node`) and the
  **Python** runtime (`boosthis-py`) — for backends. Ask the maintainer.
- The **telemetry API server** — only the maintainer runs that.

## License

Apache 2.0 (see `LICENSE`). Provided AS-IS — see `DISCLAIMER.md`.
