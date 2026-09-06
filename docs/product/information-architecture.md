# Information architecture

## Student tabs
Today · Explore · Journey · Profile · FAB Scan

## Instructor tabs
Today · Batches · Live · Inbox · Profile

## Admin tabs
Dashboard · Org · Users · Hub · Profile

## Domains
Identity · Organization · Learning · Attendance · Progress · Recognition · Certification · Communication · Analytics

Reads should be domain queries (`getToday`, `getMyCourses`, `getSessionRoster`) not a full-database dump. Realtime patches only the affected domain.
