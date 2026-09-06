# Architecture Decision Records

## ADR-001 Read model
Keep a cached `Db` for offline UI; shrink payloads (recent windows) and add domain RPCs (`getCourseOverview`, `getBatchRoster`, `getSessionRoster`) instead of a rewrite to 12 stores.

## ADR-002 Writes
All mutations via SECURITY DEFINER RPCs + `run_command` idempotency. No client table writes.

## ADR-003 Check-in online-only
Attendance is security-sensitive; excuses may queue offline.
