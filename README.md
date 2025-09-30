# Family Calendar — Starter Repo v0.1

This is a **starter** version of the Family Calendar project: a minimal web app (frontend) and minimal API (backend).
It's intentionally simple so you can deploy it easily, then we add features in slices.

## Structure
- `frontend/` — React + Vite PWA (installable). Reads events from the backend.
- `backend/` — NestJS API with two endpoints:
    - `GET /health` — sanity check
    - `GET /events` — returns sample events

## Local quick start (optional)
You'll need Node 20+ installed.

```bash
# Terminal 1
cd backend
npm ci
npm run build
npm run start  # listens on http://localhost:8080

# Terminal 2
cd frontend
npm ci
npm run dev   # opens http://localhost:5173
# then set VITE_API_URL=http://localhost:8080 in your Vercel env later
```

## Deploy (very short)
1. Push this folder to a GitHub repo.
2. Frontend → Vercel: import `frontend/`, set env `VITE_API_URL` to your backend URL, deploy.
3. Backend → Render: import `backend/`, Build: `npm ci && npm run build`, Start: `npm run start`.
4. Open the frontend URL — you should see "Starter repo v0.1" and a sample events list.
5. Add the app to your iPad Home Screen to run fullscreen (PWA).
```
