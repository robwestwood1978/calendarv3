# Family Calendar — Frontend Slice B2 (Full)
Includes:
- Fix: correct event placement in Day/3‑Day/Week
- Density setting (Comfortable/Compact)
- School‑hours shading (09:00–15:00)
- Quick Add with NLU + color/location
- Event Modal (rich fields) + RRULE builder (Daily/Weekly/Monthly/Yearly) + COUNT/UNTIL
- Exceptions: skip/move; policy to lock past occurrences
- Conflicts: per‑member overlap highlighting
- Filter bar + saved filters
- PWA SW v6

Render:
- Root: `frontend`
- Build: `npm install && npm run build`
- Publish: `dist`
- Rewrite: `/*` → `/index.html`
