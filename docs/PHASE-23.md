# Phase 23 — AI Production Router + Floyo

Status: **IMPLEMENTED** (core layer) · **NOT TESTED** (live Floyo API)

## Architecture (audit summary)

| Layer | Current | Phase 23 addition |
|-------|---------|-------------------|
| Orchestration | `server/workers.js`, `src/run-ad-generation.js` | `src/lib/generation-service.js` |
| Video generation | `src/lib/scene-videos.js` → `veo-client.js` | ModelRouter → Floyo/Google/KIE providers |
| Creative Director | `src/lib/storyboard.js` | `sceneProductionClass`, `sceneQualityRequirement` |
| Assets | `server/asset-store.js` | lineage metadata on video assets |
| UI | Timeline scene editor | Generation route + cost preview |

## New modules

- `src/lib/providers/` — GenerationProvider, Floyo, Google, KIE stub
- `src/lib/model-router.js` — cheapest-capable routing (heuristic)
- `src/lib/cost-estimator.js` — pre-flight estimates
- `src/lib/broll-engine.js` — B-roll suggestions from transcript
- `src/lib/voice-track.js` — voice/visual separation helpers

## API (server-only secrets)

```
GET  /api/providers/diagnostics
POST /api/projects/:id/generation/plan
POST /api/projects/:id/scenes/:sceneId/generation/route
POST /api/projects/:id/broll/suggest
GET  /api/projects/:id/production/costs
```

## Setup

1. Add `FLOYO_API_KEY` to server `.env` (never commit)
2. Configure workflow IDs from Floyo dashboard
3. Optional: `FLOYO_GPU_COST_USD_PER_MIN` for heuristic cost display

## Tests

```bash
npm run test:phase23:router   # routing heuristics (no API)
npm run test:phase23:floyo    # Floyo health (needs API key)
```

## Regression

- `AI_ROUTER_ENABLED=false` restores direct Veo path in `scene-videos.js`
- UGC/dialogue routes to Google/Veo (premium) by default
- Floyo/KIE require `generationApproved: true` on jobs
