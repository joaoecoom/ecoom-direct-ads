# Deploy frontend (Vercel)

Static site lives in `web/`. Vercel reads `vercel.json` at repo root.

- **Production:** https://web-liard-pi-k8e9ujwuis.vercel.app
- **API proxy:** `/api/*` → VPS `169.58.195.244`

Push to `main` triggers Vercel deploy when GitHub is connected.
