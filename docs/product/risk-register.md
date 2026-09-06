# Risk register

| Risk | Impact | Probability | Mitigation |
| --- | --- | --- | --- |
| Full DB fetch at scale | High | High | Recent windows + domain RPCs (overview/roster) |
| QR seed leak | High | Low | Server-only seed, rotating HMAC |
| Join-code brute force | Med | Med | Rate limit RPC |
| Certificate dead APP_URL | Med | Med | Set production URL |
| Accessibility untested on device | High | High | VoiceOver/TalkBack before release |
