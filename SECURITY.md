<!--
  BOOSTHIS-OWNED — DO NOT EDIT.
  This file is vendored from the Boosthis kit. Editing it makes the kit report
  a tamper mismatch (run `./boosthis verify .`), which can disable the kit on
  the next entitlement check-in. To change Boosthis, update it via the hosted
  Boosthis MCP server instead of editing here.
-->
# Security Policy

Thank you for helping keep Boosthis and its users safe.

## Reporting a vulnerability

**Please do not file public GitHub issues for security reports.** Public
issues are visible to everyone and can be exploited before a fix ships.

Instead, report vulnerabilities privately by contacting the Boosthis
maintainer through your account. Boosthis is a paid product delivered by
value rather than through a public registry, so reports go directly to the
maintainer rather than to any public tracker.

Please include:

- A description of the issue and its impact.
- Steps to reproduce, ideally with a minimal example.
- The Boosthis version and runtime (`boosthis version` output).
- Whether you would like credit in the eventual release notes.

## What to expect

- We will acknowledge receipt within **5 business days**.
- We will keep you updated on remediation progress.
- Once a fix is available, we will publish a patched release and a
  GitHub Security Advisory describing the issue. With your consent, we
  will credit you.

## Scope

In scope:

- The Boosthis Python package (`lib/boosthis-py/`) and React Native runtime
  (`lib/boosthis-runtime-rn/`).
- The Boosthis MCP server (`boosthis mcp`) and HTTP server (`boosthis serve`).
- The telemetry / consent endpoints under `artifacts/api-server/`.
- The PII denylist and `safe_transmit` / `assert_no_pii` guards.

Out of scope:

- Vulnerabilities in third-party AI tools (Claude Desktop, Cursor, etc.)
  that consume Boosthis's MCP interface. Please report those to the
  respective vendor.
- The mockup sandbox under `artifacts/mockup-sandbox/`, which is a
  development-only environment.
- Issues that require the operator to deliberately disable Boosthis's
  safety defaults (for example, binding `boosthis serve` to `0.0.0.0` on
  a public network).

## Coordinated disclosure

We follow a coordinated disclosure model. We ask that you give us a
reasonable window — typically **90 days** from the date of the initial
report — to publish a fix before disclosing details publicly. We are
happy to coordinate a shorter timeline if a fix lands quickly, or a
longer one if the issue is unusually complex.

Thank you for reporting responsibly.
