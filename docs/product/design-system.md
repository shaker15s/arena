# Masar design system

> **Status:** Current implementation contract. For the audited component-by-component list, see [`surface-inventory.md`](./surface-inventory.md). The longer research and rollout plan is [`IMPLEMENTATION_PLAN_APPLE_DESIGN.md`](../../IMPLEMENTATION_PLAN_APPLE_DESIGN.md).

## Sources of truth

- `src/design/tokens.ts` — semantic colors, spacing, type, shape, elevation, and motion values.
- `src/design/theme.tsx` — system/light/dark/OLED theme selection.
- `src/design/glass.tsx` — the only implementation adapter for glass material and its platform fallbacks.
- `scripts/check-glass-policy.js` — static guard against leaking blur/filter APIs or glass-fill tokens into feature components.

Use semantic roles from the theme rather than hard-coding a light/dark color in a screen. Arabic is the default language and layout is RTL-first; use logical `start`/`end` properties for directional spacing.

## Surface contract: content first, controls above it

| Role | Use | Implementation |
|---|---|---|
| App canvas | Page background and restrained ambient decoration | `AppBackground`; `theme.bg` and its gradient tokens |
| Content surface | Cards, forms, rows containing information, metrics, dialogs, reports, and certificate UI | Opaque `theme.card`; `Card` is solid by default |
| Control fill | Compact, non-floating selection/control fills | `theme.fill`, `theme.fillStrong`, and `theme.fillBorder`; this is not a glass effect |
| Adaptive glass | Navigation or a clearly floating control/action placed above scrolling or visual content | `GlassSurface` only |

**Do not blur or make information-bearing content translucent.** In particular, no glass behind form fields, list data, reports, charts, KPIs, attendance states, or certificate content. Do not stack independent glass surfaces. Prefer a solid primary action unless a floating action needs a separate visual layer.

`theme.glass`, `theme.glassHeavy`, and `theme.glassBorder` are implementation tokens owned by `GlassSurface`; screens and content components must not read them directly. A small control using `theme.fill` is a normal control fill, not a glass surface.

## `GlassSurface` platform contract

The visual effect is progressive enhancement. The underlying task and action must remain clear when no blur API is available.

| Platform/state | Rendering |
|---|---|
| iOS 26+ with the Expo API available | Native `GlassView` material |
| Older supported iOS | Restrained `BlurView` fallback |
| Web | `backdrop-filter` enhancement on the surface only |
| Android and unsupported native environments | Static, high-opacity theme fill; no promise of iOS-equivalent blur |
| Reduce Transparency | Opaque `theme.card` fill, with CSS/native material suppressed |
| High Contrast | Opaque `theme.card` fill and a stronger visible border; blur is disabled |

The adapter checks native API availability and honors the app's Reduce Transparency preference plus the supported system preference. Web filtering is optional; a browser without `backdrop-filter` must still show a usable tinted surface. Do not add a second blur implementation in a screen or component.

## Component guidance

- `Card` and `GlassCard` render solid content surfaces by default. `GlassCard` is a historical export name; it is **not** translucent.
- `Card glass` is a compatibility opt-in for a deliberately floating surface and delegates to `GlassSurface`. There are currently no screen call sites requesting that opt-in.
- `LiquidGlassCard` is deprecated compatibility API and renders an ordinary solid card. Do not use it for new work.
- `GlassBtn` is reserved for floating controls and delegates its material to `GlassSurface`.
- Sticky bottom actions over a scrolling screen may use one edge-to-edge `GlassSurface`; keep the CTA itself legible and solid.
- A sheet/dialog is a modal content surface, not a glass card. Dismiss or avoid overlapping a separate floating control when necessary.

## Accessibility and layout

- The material is decorative: it must never carry meaning that disappears in the solid fallback.
- Do not rely on transparency to achieve text contrast. Text and status indicators sit on opaque content surfaces; status also has an icon or label.
- Preserve a visible focus ring, keyboard operation, screen-reader role/name, and a minimum 44 pt touch target where practical. Web controls must also meet WCAG 2.2 target-size requirements or a documented exception.
- Respect Reduce Motion and Reduce Transparency. Test long Arabic copy, RTL/LTR, 320 px layouts, text enlargement, and both light and dark themes.
- Keep one logical floating material group per context; no glass-on-glass layering.

## Quality gates

Run after surface or theme changes:

```sh
npm run glass:check
npm run contrast
npm run a11y
npm run typecheck
npm run build
```

`npm run test:all` runs the repository's full static and logic-level suite. It does not, by itself, mean that a browser journey, real OAuth/session, native device, assistive technology, or user study was exercised. See [`testing.md`](./testing.md) for the evidence and limits of each test layer.
