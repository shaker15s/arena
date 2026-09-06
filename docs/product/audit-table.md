# Audit table (spec §236)

| ID | Area | Finding | Severity | Status |
| --- | --- | --- | --- | --- |
| DATA-001 | Fetch | Full-table attendance/points/notifications | P1 | Mitigated (recent windows) |
| TODAY-001 | Today | KPI-first vs task-first | P1 | Mitigated (live session first) |
| SCAN-001 | Scanner | Generic errors | P1 | Mitigated (not_enrolled / expired copy) |
| ADMIN-001 | Dashboard | No “needs attention” | P1 | Mitigated (NeedsAttention) |
| A11Y-001 | A11y | Device audit | P0 | Open / NOT VERIFIED |
| E2E-001 | QA | Golden path E2E | P0 | Open / NOT VERIFIED |
| RLS-001 | Security | Live Postgres RLS | P0 | Open / NOT VERIFIED |
| SEARCH-001 | Search | Latin-only includes | P2 | Mitigated (Arabic normalize) |
| A11Y-002 | Type | Font scale 140% | P1 | Mitigated (200% maxFontSizeMultiplier) |
| LIST-001 | Admin users | Map all profiles | P2 | Mitigated (FlatList window) |
| ANALYTICS-001 | Privacy | PII in events | P1 | Mitigated (track() denylist) |
| DATA-002 | Sessions | Full session history | P1 | Mitigated (21d–120d window + live) |
| READ-001 | Today | No getToday RPC | P1 | Mitigated (get_today / get_my_courses) |
| NAV-001 | Notifications | Open home only | P1 | Mitigated (type → screen) |
