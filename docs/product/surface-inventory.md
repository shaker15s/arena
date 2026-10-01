# Surface inventory

**Reviewed:** 1 October 2026 against the current `src/` tree. This inventory covers adaptive glass and translucent surface roles; it is not an exhaustive catalogue of every brand/status color, illustration, or certificate/PDF constant.

## Adaptive glass surfaces

| Surface | Source | Product role | Decision / state |
|---|---|---|---|
| Main tab bar | `src/app/RootNavigator.tsx` → `AppleTabBar` | Persistent navigation above each role's content | **Active and compliant.** One `GlassSurface` contains the tab group and optional central scan action; content reserves space below it. |
| Onboarding “skip” and “have account” controls | `src/features/auth/AuthScreens.tsx` → `GlassBtn` | Contextual secondary actions | **Active and compliant.** `GlassBtn` delegates its fill/effect to `GlassSurface`; primary onboarding action remains a clear, solid branded control. |
| Course-detail join action | `src/features/explore/ExploreScreens.tsx` | Sticky CTA over a scrolling course detail | **Active and compliant.** The edge-to-edge footer now uses `GlassSurface`; the join button itself remains solid. |
| Organization-wizard navigation | `src/features/org/WizardScreen.tsx` | Sticky Back/Next/Finish actions over a scrolling form | **Active and compliant.** One bottom surface uses `GlassSurface`; fields and step content remain opaque. |
| Opt-in `Card glass` API | `src/design/components.tsx` | Compatibility option for a future, explicitly floating card | **No current screen call sites.** If retained, it now renders through `GlassSurface`; do not use it for information cards. |

All of the above use one implementation adapter at `src/design/glass.tsx`. Its platform behavior is documented in [`design-system.md`](./design-system.md). Do not infer identical material rendering across platforms.

## Solid content and ordinary control fills

| Component/area | Source | Audit result |
|---|---|---|
| Course catalog/detail cards | `src/features/explore/ExploreScreens.tsx` | Uses `theme.card` and `theme.fillBorder`; removed the semi-transparent `cardElevated` fill so text is not composited over ambient content. |
| List rows | `src/design/components.tsx` → `ListRow` | Uses an opaque `theme.card` surface and `theme.fillBorder`, not the translucent glass token. |
| Spotlight card | `src/design/components/SpotlightCard.tsx` | Uses an opaque content surface; the spotlight remains a pointer-following decorative overlay. The component currently has no screen call site beyond its export. |
| Chips | `src/design/components.tsx` → `Chip` | Uses `theme.fill` for the unselected control fill. This is a compact control fill, not blur/glass. |
| Notification icon button | `src/design/components/NotificationBell.tsx` | Uses semantic `theme.fill` and `theme.fillBorder`, not a hard-coded translucent fill. |
| Sheets and celebration dialogs | `src/design/components.tsx`, `src/design/celebrations.tsx` | Opaque `theme.card` surfaces; borders use `theme.fillBorder`. |
| General cards and metric bubbles | `src/design/components.tsx`, `src/design/glass.tsx` | Solid by default. No `backdrop-filter` on `StatBubble`. |
| `GlassCard` | `src/design/glass.tsx`; used by auth screens | Historical name only; renders an opaque `theme.card` content surface. |
| `LiquidGlassCard` | `src/design/components/LiquidGlassCard.tsx` | Deprecated, solid compatibility component. No JSX screen call site was found; it remains exported for compatibility. |
| App background | `src/design/glass.tsx` → `AppBackground` | Gradient and restrained ambient decoration; this is not an adaptive glass surface. Ambient orbs are static and suppressed for reduced transparency/high contrast. |

The `cardElevated` theme role was removed after the last feature call site was moved to the opaque card role. Existing `glassShadow` references are elevation color only; they do not apply transparency or blur.

## Static-policy result

After this audit, no source file outside `src/design/glass.tsx` reads `theme.glass`, `theme.glassHeavy`, or `theme.glassBorder`. Direct `BlurView`, Expo `GlassView`/availability checks, and inline `backdropFilter` are also restricted to the adapter by `npm run glass:check`.

## Not covered by this inventory

- A human-led, exhaustive classification of the repository's hard-coded hex/RGBA values. Many such values are deliberate status colors, illustrations, generated assets, or certificate colors; the earlier source audit counted them but did not establish that they are glass-policy violations.
- Figma prototypes, user feedback, real Supabase/OAuth journeys, or iOS/Android native rendering. These need design/research participants, working service credentials, or native build/device environments and must not be represented by this static inventory.
