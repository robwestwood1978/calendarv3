# Slice B2 Patch — Simple Steps

## 1) Make a backup
Duplicate your project folder first.

## 2) Copy these files into your project
From this patch, copy the following to your project and **replace** the originals:

- `frontend/src/state/members.ts`
- `frontend/src/state/settings.ts`
- `frontend/src/components/FilterBar.tsx`
- `frontend/src/components/AdminPanel.tsx`
- `frontend/src/pages/Settings.tsx`
- `frontend/src/pages/Calendar.tsx` (we added double‑click to edit)

> If asked to overwrite, click **Replace**.

## 3) Install and run
```
cd frontend
npm i
npm run dev
```

## 4) One-time setup
- Go to **Settings → Open Admin**
- Add your **Members**, **Tags**, and any **Color Rules**.

## 5) Test
- Drag an event → snaps to 15 mins, no duplicate.
- Double‑click an event → opens the edit modal.
- Filter by **Member**, **Tag**, and search box.

If anything looks off, send me a screenshot of the Calendar page and I’ll adjust.
