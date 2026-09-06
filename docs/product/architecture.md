# Architecture

- Writes: RPC `SECURITY DEFINER` only (`src/data/actions.ts`).
- Reads: `fetchRemoteDb` still aggregates many tables (P1 to shrink). Recent windows for attendance/points/notifications.
- Realtime: `applyRealtimePatch` for sessions/attendance/enrollments/points/excuses/notifications/courses/batches/certificates; unknown tables → refresh.
- Offline: command queue + `run_command` idempotent. Check-in remains online-only (security).
- Authority: eligibility, QR, capacity, kudos quota, certificates — server.
