# Deploy frontend (Vercel)

Static site lives in `web/`. Vercel reads `vercel.json` at repo root.

- **Production:** https://ecoom-direct-ads.vercel.app
- **Creative Studio:** Fase 1 — app shell + projects (localStorage)
- **API proxy:** `/api/*` → VPS `169.58.195.244`

Push to `main` triggers Vercel deploy when GitHub is connected.
