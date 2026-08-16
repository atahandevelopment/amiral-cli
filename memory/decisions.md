# Architectural Decisions

## ADR-001: Volvo Car Bern site clone — confirmed user decisions (2026-08-16)

Context: User requested a web-scraped copy of https://www.volvocars-partner.ch/volvo-car-bern/de/homepage using Next.js for the frontend. All pages and forms are to be created.

Decisions (confirmed by user):

1. **Form submissions:** Demo mode only — submissions are accepted and logged locally; no real email transport (no SMTP/Resend credentials). Implement a demo inbox file (e.g. `.data/inbox.json`).
2. **Images:** Keep the scraped (copyrighted) images. Site is for private demo use only; user will handle any licensing concerns.
3. **URL scheme:** Clean routes (e.g. `/modell/xc60`), NOT the original `/volvo-car-bern/de/` prefix.
4. **Git:** Initialize the repository (`git init`) with an initial commit after scaffold.
5. **Deployment:** Local only for now; no public hosting.
6. **Forms:** The 4 external form links (Probefahrt, Offertenanfrage, Zubehöranfrage, Werkstatttermin) are replaced with local Next.js form pages.
7. **Font:** Volvo Novum is proprietary and will NOT be copied; substitute with Inter/system font stack.

Status: Accepted. Source: Lead/Planner plan session 2026-08-16.
