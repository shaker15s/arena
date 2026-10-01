# Testing and QA evidence

## Automated checks

- `npm run test:all` runs TypeScript checks, static accessibility/layout/glass/contrast/i18n/RPC/SQL checks, and deterministic logic/security/performance/scenario suites.
- `npm run build` exports the production web bundle to `dist/`.
- `npm run glass:check` is a source-policy guard: only `src/design/glass.tsx` may own blur APIs, CSS backdrop filtering, or glass-fill tokens.
- `npm run contrast` checks the token color pairs defined by its script. It does **not** compute the contrast of a translucent surface composited over arbitrary content.
- `npm run a11y` is a static screen/semantics audit, not a VoiceOver/TalkBack session.
- `npm run test:perf` is a deterministic local benchmark, not a frame-time or battery measurement on a representative device.

The files under `e2e/` are **logic-level scenario tests**. The canonical command is `npm run test:scenarios`; `npm run test:e2e` remains only as a backwards-compatible alias. They use mocked/test data and do not launch a browser, authenticate against Google/Supabase, or prove that a real user completed a journey. The historical folder and alias must not be presented as evidence of browser E2E coverage.

## Browser visual and interaction review

A production web export was opened in Chromium with Playwright on **1 October 2026**. The onboarding and sign-in screens were reviewed at `1365×900`, `390×844`, and `320×640`; mouse/touch progression, theme switching, focus behavior, RTL layout, and horizontal overflow were checked. The Reduce Transparency fallback was inspected in the DOM for light and dark themes. The review caught and fixed a focus-scroll defect and a React Native Web data-attribute issue; details are in §14 of [`IMPLEMENTATION_PLAN_APPLE_DESIGN.md`](../../IMPLEMENTATION_PLAN_APPLE_DESIGN.md).

A follow-up Chromium smoke also opened the production export with a **locally injected mock session** and intercepted Supabase Auth/REST responses (no request authenticated against the real service). It rendered the student shell at `390×844`, volunteer shell at `1365×900`, and admin shell at `320×640`; it navigated the student through Explore → a seeded course detail and confirmed the sticky CTA and both tab/CTA `GlassSurface` nodes. The browser reported no page errors, and `document`/`body` widths matched the viewport at all three sizes. The course-detail surface reported computed `backdrop-filter: blur(20px) saturate(1.5)` in Chromium. A blocked Supabase Realtime WebSocket was excluded from page-error assertions; that connection is not mocked or verified. A separate preference-seeded run verified in Chromium that both **High Contrast** and **Reduce Transparency** render the sampled glass surface with `backdrop-filter: none` and an opaque white fill at `390×844`.

Together these are real browser observations of representative web screens, including mocked signed-in role shells, but **not** a live service/OAuth journey or exhaustive coverage of every signed-in workflow. No Playwright package/browser test has been added to the repository, so these manual/one-off runs are not automatically repeated by `npm run test:all`.

## Not verified

- Signed-in student/volunteer/admin workflows against a live Supabase project or Google OAuth. The preview environment did not have a valid authenticated session; external Realtime requests were closed.
- iOS/Android native rendering, device performance, VoiceOver, or TalkBack. No native device/build environment was available during the review. The requested deliverable is the website; native parity is not a web release gate.
- Human task testing, Figma review, or rollout/production analytics. These require real participants, design collaboration, service access, and a deployed audience; a code agent cannot honestly substitute for them.

Report each layer separately: passing static checks do not imply visual QA; browser QA does not imply live OAuth; mocked scenario tests do not imply production data integrity; and no simulation should be described as a user study or native-device test.
