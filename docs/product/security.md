# Security

UI hides; backend enforces.

Threats to keep testing: IDOR, role escalation, QR replay/forgery, join-code enumeration (rate-limited), certificate public verify (minimum fields).

QR: rotating HMAC slot, previous window only, session-bound. `qr_seed` must never reach client cache/realtime.
