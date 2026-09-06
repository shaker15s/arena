# MASAR_RELEASE_CERTIFICATION

| Area | Status | Evidence | Known limitations | Risk | Owner |
| --- | --- | --- | --- | --- | --- |
| Auth (Google) | PASS WITH LIMITATIONS | `supabase.ts` + AuthScreens | Real OAuth on device NOT VERIFIED | Redirect misconfig | Eng |
| Student Today | PASS WITH LIMITATIONS | `TodayScreen.tsx` task-first reorder | Usability study NOT VERIFIED | Cognitive load | Product |
| Attendance / QR | PASS WITH LIMITATIONS | engine tests + RPC | Real camera/geofence device NOT VERIFIED | Replay if seed leaks | Security |
| Certificates verify | PASS WITH LIMITATIONS | publicVerifyUrl + RPC | Production APP_URL must be set | Dead links | Eng |
| Offline writes | PASS WITH LIMITATIONS | `offline.ts` + run_command | Check-in online-only by design | Excuse queue only | Eng |
| Accessibility | NOT VERIFIED | labels/44pt in code | VoiceOver/TalkBack/200% | WCAG fail | Design |
| Performance at 5k rows | NOT VERIFIED | recent-window reads | fetchRemoteDb still wide | Slow org | Eng |
| E2E golden paths | NOT VERIFIED | — | No Detox/Playwright | Silent regressions | QA |
| Security pentest | NOT VERIFIED | RLS unit mirror | Real Postgres RLS job best-effort | IDOR | Security |
| Load test | NOT VERIFIED | — | — | Outage | Ops |
