<!--
  BOOSTHIS-OWNED — DO NOT EDIT.
  This file is vendored from the Boosthis kit. Editing it makes the kit report
  a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
  the next entitlement check-in. To change Boosthis, update it via the hosted
  Boosthis MCP server instead of editing here.
-->
# Boosthis — Disclaimer

_Last updated: 2026-09-25_

Boosthis is a free, open-source developer tool. Please read this before
relying on it in any production context.

## No warranty

Boosthis is provided **"as is," without warranty of any kind**, express or
implied, including but not limited to the warranties of merchantability,
fitness for a particular purpose, and non-infringement. The full warranty
disclaimer is in `LICENSE`.

## Use at your own risk — no liability for data exposure

You use Boosthis **entirely at your own risk**. Boosthis runs inside your
own application's process, and **you remain solely responsible** for:

- the data your application collects, stores, logs, or transmits;
- what you place into route names, metadata fields, and any payload
  Boosthis can see;
- reviewing every AI-suggested change before you ship it.

Boosthis's PII guard is a **best-effort defence against common identifier
and secret field names** — it is not a guarantee, and no automated guard
can catch every way data might be mislabelled or exposed by the host app.
To the fullest extent permitted by applicable law, the Boosthis **owner,
creator, administrator, maintainers, and contributors** (together, the
"Protected Parties") are **not liable for any data exposure, leak, loss,
corruption, downtime, security incident, regulatory penalty, or other
damages** of any kind — whether direct, indirect, incidental, special,
consequential, exemplary, or punitive — arising from your use of, or
inability to use, Boosthis, even if advised of the possibility. You use
Boosthis **entirely at your own risk**, you **assume all such risk**, and
to the fullest extent permitted by law you **release the Protected Parties**
from all such claims. This restates, in plain language, the warranty
disclaimer and limitation of liability in `LICENSE` (Apache License 2.0,
sections 7 and 8). The full, controlling terms are in
[`TERMS.md`](./TERMS.md) (Sections 11–13).

## What the kit costs, and what "safe" means here

Boosthis runs inside your application's process, so installing it is not
free. What it costs is **measured, per runtime, against the same application
with the kit absent** — throughput, added latency per request, resident
memory, and for the browser kit the bytes every visitor downloads. Those
figures are published in two places: the install guide this project's own
server hands your AI tool, and `docs/kit-install-cost.md` in the source
repository, which is generated from the measuring rig's own record. A runtime
nobody has measured yet **says so** there rather than being left blank, and no
figure anywhere is estimated from another runtime's.

Every kit wraps its public entry points so that a bug inside Boosthis returns
a value to your code instead of throwing into it, and each runtime's own test
suite has a case that checks it. **That is a discipline we keep and check, not
a warranty.** It does not cover a fault that starves your process rather than
throwing in it, and it says nothing at all about speed.

Some kits' release notes carry an older sentence saying Boosthis "can never
slow or crash your app". **That sentence is superseded by this section.** The
speed half was never measured and the published figures contradict it; the
crash half is the checked wrapping discipline described above, which is not a
guarantee. Where any Boosthis document, guide, release note, or marketing
page promises more than this section does, this section and the "no warranty"
and "use at your own risk" sections above govern, together with `LICENSE` and
[`TERMS.md`](./TERMS.md).

## AI-generated suggestions require human review

Boosthis exposes its rule catalog and live performance samples to AI
agents (Claude, Cursor, Replit AI, and any other MCP-capable tool) via
its MCP server and HTTP API. When an AI agent uses Boosthis to propose a
code change, **that change is a suggestion, not an approval**.

- Boosthis does **not** validate the correctness, security, or
  production-readiness of any fix an AI agent proposes.
- A "green" Boosthis meter measures latency only — it does **not**
  measure functional correctness, data integrity, or behavioural
  equivalence.
- AI-proposed fixes have **not** been reviewed by Boosthis's maintainers
  before reaching your codebase.

**Always review AI-generated changes before merging or deploying.** The
human operator of the codebase remains responsible for what ships.

## Not a data processor

Boosthis is a library that executes **inside the host application's own
process**. It does not relay data to a separate service controlled by
Boosthis unless the operator has explicitly opted in to telemetry (see
`PRIVACY.md`).

For the avoidance of doubt:

- Boosthis is **not** a data processor under GDPR Article 28 in its
  default (telemetry-off) configuration.
- The operator of the host application remains the controller and, where
  applicable, the processor of any personal data the host application
  handles. Boosthis provides primitives; the operator is responsible for
  compliance with GDPR, CCPA, HIPAA, and any other regulatory regime
  applicable to their app.
- Boosthis does not offer, and does not need to offer, a Data Processing
  Agreement in its default configuration. If your compliance team
  believes one is required, that is the signal to re-read this section
  with them.

## Compatibility statements, not endorsements

Boosthis describes itself as "compatible with Claude Desktop, Cursor, and
Replit AI via the open Model Context Protocol." That is a factual
statement about interoperability with a public protocol. It is **not** a
statement of endorsement or partnership with Anthropic, Cursor, Replit,
or any other vendor. The vendors named have not reviewed, sponsored, or
approved Boosthis.

## Suggestions, not approvals — the operational rule

If you take one thing from this document:

> Every fix Boosthis or an AI agent proposes is a suggestion. A human in
> the loop must review it before it ships. Boosthis exists to make that
> reviewer faster and better-informed, not to replace them.

## Contact

For questions, contact the Boosthis maintainer who provided your invitation.
For security reports, see `SECURITY.md`.
