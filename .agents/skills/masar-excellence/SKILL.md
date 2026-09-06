---
name: masar-excellence
description: >-
  Executes the 260-directive Masär Master Rebuild & Product Excellence Specification.
  Enforces zero-trust database security, WCAG 2.2 AA accessibility, authentic Arabic-first
  typography, offline resilience, and formal release certification across the training operating system.
---

# Masär Product Excellence & Rebuild Engine

## Overview
This skill codifies the complete 260-directive Master Rebuild & Product Excellence Specification for Masär (`shaker15s/arena`). It provides an end-to-end operational protocol for auditing, engineering, verifying, and certifying features as a production-grade training operating system rather than an administrative prototype.

## Dependencies
* Node.js >= 20
* TypeScript strict (`npm run typecheck`)
* Supabase CLI / PostgreSQL 15+ (`supabase/migrations/`)
* Expo SDK 57 / React Native 0.86+

## Quick Start
To verify and certify the codebase against the master specification:
```bash
# Execute the full quality and anti-cheat verification harness
npm run test:all

# Verify web production packaging and module bundling
npm run export:web
```

## Rebuild & Verification Workflow

### 1. Forensic Verification Phase (§15, §122)
Before modifying code or accepting audit claims:
- Re-verify all findings against live source code and PostgreSQL migrations.
- Classify each item into: `Confirmed`, `Historical` (resolved in past commits), `Claimed` (docs only), or `Needs verification`.
- Ensure critical fixes (e.g. room collision check in `0007`, public URL on certificate QR, separated CSV/PDF roster exports) are retained.

### 2. Information Architecture & Mental Models (§4, §28-§30)
- Enforce the 3 specialized mental models:
  - **Student**: "What is happening today?" (Urgent session hero card, streak counter, immediate scan CTA).
  - **Instructor**: "What must I do in this session?" (Active batch, 1-tap live session launch, live roster counter, report export).
  - **Admin**: "What requires my intervention?" (Needs Attention triage: pending excuses, room conflicts, unassigned batches).
- Maintain 4 primary destinations in the bottom tab bar to prevent visual overwhelm.

### 3. Design System & WCAG 2.2 AA Standards (§18-§25, §56-§64)
- **Interactive Bounds**: Minimum 44×44 points hit slop on all buttons and touchable icons.
- **Contrast**: Minimum 4.5:1 on body text; never communicate state using color alone.
- **Reflow & Font Scaling**: Support 320px viewport without two-dimensional scroll; support 200% font scaling without text clipping.
- **Liquid Glass Boundary**: Limit native blur overlays to floating navigation, headers, and modal sheets; maintain high-contrast solid backgrounds for dense forms and data tables.

### 4. Zero-Trust Security & Data Boundaries (§16-§17, §98)
- 100% of write policies on public tables are revoked.
- All mutations must pass through `SECURITY DEFINER` RPCs verifying caller identity via `auth.uid()`.
- Rotating QR tokens must enforce the 25-second cryptographic seed to prevent screenshot sharing.
- Batch enrollment must serialize concurrent joins using `SELECT ... FOR UPDATE` to eliminate race conditions.

### 5. Offline Queue & Reconnect Protocol (§12, §165)
- Cache reads locally via `AsyncStorage` (`masar.cache.v2`) tied to the authenticated user ID.
- Record non-time-sensitive offline mutations into `command_queue` with client-generated UUID idempotency keys.
- Automatically replay pending commands in chronological order upon network reconnection via `execute_command_queue`.

### 6. Acceptance & Release Certification (§254, §255)
Every production release must be recorded in `MASAR_RELEASE_CERTIFICATION.md` across all 20 primary operational domains with explicit status:
- `PASS`
- `PASS WITH LIMITATIONS`
- `NOT VERIFIED`
- `FAIL`

## Common Mistakes & Anti-Patterns
1. **Treating Existing UI as the Specification**: Never assume an existing screen is correct simply because it is in the repository. Design for user intent and task completion.
2. **Global Monolithic Fetches**: Do not fetch the entire database in a single payload; consume granular domain queries (`domain.ts`).
3. **Decorative Animations**: Do not add floating background particles or infinite animations that distract users or degrade 60fps performance on budget devices. Always respect `isReducedMotion()`.
4. **Documentation Drift**: Never allow `README.md` or auxiliary docs to contradict the canonical documentation suite in `docs/product/`.
