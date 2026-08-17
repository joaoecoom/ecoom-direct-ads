# Arquitetura de Migração — Creative Studio

> Análise do repo existente + plano incremental. Agosto 2026.

---

## 1. O que existe hoje (reutilizar)

### Pipeline (`src/`)

| Módulo | Função | Reutilização |
|--------|--------|--------------|
| `run-ad-generation.js` | Orquestrador completo | **Core** — extrair steps individuais depois |
| `lib/storyboard.js` | Gemini → JSON cenas | FASE 2+ blueprint |
| `lib/imagen.js` | Imagem + variação UGC | FASE 3 image workflow |
| `lib/veo-client.js` + `generate-sequence.js` | Clips + concat | FASE 4 animate |
| `lib/ad-config.js` | Settings globais | Estender com `totalDurationSeconds` |
| `lib/tts.js`, `lipsync.js` | PT-PT path | Preservar intacto |

### API (`server/`)

| Endpoint | Estado | Evolução |
|----------|--------|----------|
| `POST /api/jobs` | Pipeline completo | Mantém — vira `Generation` tipo `full_ad` |
| `POST /api/jobs/batch` | Fila batch | Mantém |
| `GET /api/jobs/:id` | Progresso | Estender com `scenes[]` no result |
| `job-store.js` | JSON por job | Modelo base para `project-store` |

### Frontend (`web/`)

- Formulário single-page → **substituir por app shell**, lógica de job polling **migrada** para `js/create-ad.js`
- `config.js` + proxy Vercel → **inalterado**

---

## 2. Gap analysis (spec vs. código)

| Feature spec | Hoje | Fase |
|--------------|------|------|
| Sidebar + projects | ❌ | 1 |
| Master prompt persistente | ❌ (só textarea) | 1–2 |
| Duração total → N cenas | Parcial (`sceneCount * clipDuration`) | 2 |
| Assets como entidades | ❌ (ficheiros em `assets/run-*`) | 3 |
| Generate N imagens | ❌ (1 por cena no pipeline) | 3 |
| Animate single scene | ❌ (só pipeline batch) | 4 |
| Animate All | ❌ (implícito no pipeline) | 4 |
| Timeline UI | ❌ | 5 |
| Regenerar imagem/vídeo isolado | ❌ | 6 |
| Dependency graph + outdated | ❌ | 6 |
| Rebuild final incremental | ❌ (sempre regen completo) | 7 |
| Versionamento assets | ❌ | 6–7 |
| Upload referências | ❌ | 3 |
| >5 cenas / 3min vídeo | Limitado (`AD_SCENE_COUNTS` max 5) | 4+ (backend) |

---

## 3. Novo modelo de dados (alvo)

```text
Project
  id, name, masterPrompt, settings, createdAt
  └── Creative (1..N por project)
        id, status, blueprint (storyboard JSON)
        └── Scene[]
              id, order, duration
              imagePrompt, motionPrompt, voiceover
              imageAssetId → Asset
              videoAssetId → Asset
              status: { prompt, image, video, timeline }
              versions: { image: [], video: [] }
        └── Timeline
              sceneOrder[], crossfade, trim
        └── Export[]
              finalVideoPath, copy, createdAt

Asset
  id, projectId, type (image|video|upload)
  source (generated|upload|variation)
  prompt, path/url, metadata, createdAt

Generation (job)
  id, type: full_ad | storyboard | image | video | rebuild
  projectId?, creativeId?, sceneId?
  status, progress, result, costEstimate?
```

**Relação com jobs actuais:** cada `Job` existente mapeia para `Generation` tipo `full_ad`. Campos novos opcionais (`projectId`, `creativeId`) — retrocompatível.

---

## 4. Refactor pipeline (incremental, não rewrite)

### Fase A — Extrair funções (sem mudar comportamento)

```javascript
// run-ad-generation.js — futuro
export async function generateBlueprint(offer, adConfig) { ... }
export async function generateSceneImages(storyboard, adConfig, onProgress) { ... }
export async function animateScenes(scenes, adConfig, onProgress) { ... }
export async function buildFinalVideo(clips, options) { ... }

export async function runAdGeneration(...) {
  // composição actual — chama as 4 acima
}
```

### Fase B — Endpoints granulares

```text
POST /api/projects/:id/creatives          → blueprint only
POST /api/creatives/:id/scenes/:id/image  → 1 imagem
POST /api/creatives/:id/scenes/:id/video  → 1 clip Veo
POST /api/creatives/:id/animate-all       → fila N jobs
POST /api/creatives/:id/rebuild           → ffmpeg only
```

Cada endpoint usa a **mesma fila** `processQueue` com tipos de job.

---

## 5. Dependency graph (FASE 6)

```javascript
const SCENE_DEPS = {
  image: ["imagePrompt"],
  video: ["imageAsset", "motionPrompt"],
  final: ["all scene videos"],
};

function markOutdated(scene, changed) {
  if (changed === "image") scene.videoStatus = "outdated";
  if (changed === "video" || changed === "image") creative.finalStatus = "needs_rebuild";
}
```

Persistir em `data/projects/{id}.json` ou SQLite futuro.

---

## 6. Frontend architecture

```text
web/
  index.html              # App shell
  styles.css              # Design tokens
  config.js
  js/
    app.js                # Router (#/projects, #/project/:id, ...)
    projects.js           # CRUD (localStorage → API sync FASE 2)
    create-ad.js          # Job polling + form (pipeline actual)
    api.js                # fetch wrappers
    settings.js           # Global settings helpers
    timeline.js           # FASE 5
    scenes.js             # FASE 4–6
```

**Router hash-based** — zero build step, deploy Vercel inalterado.

---

## 7. FASE 1 — entregue agora

- [x] App shell dark + sidebar
- [x] Projects (localStorage)
- [x] New / duplicate / delete project
- [x] Project workspace com Master Prompt + Create Ad
- [x] Library, Templates, Settings, Account (placeholders)
- [x] Duração total → cálculo sugerido de cenas (UI; max 5 até backend expandir)
- [x] Pipeline actual intacto via `POST /api/jobs`

---

## 8. Próximos passos (ordem)

1. **FASE 2** — `server/project-store.js` + sync API; creative blueprint guardado no project
2. **FASE 3** — `POST .../image`, asset store, upload multipart
3. **FASE 4** — extrair `animateScene`, `animate-all`, expandir `AD_SCENE_COUNTS` + fila paralela controlada
4. **FASE 5** — timeline component + preview clips
5. **FASE 6** — regenerate endpoints + versioning
6. **FASE 7** — `rebuildFinal` ffmpeg-only path

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|-------|-----------|
| Rewrite acidental | `runAdGeneration` permanece entry point até FASE 4 |
| Custos Veo | Dependency graph + job type `rebuild` sem Veo |
| 30 cenas = fila longa | Workers paralelos limitados (max 2 Veo simultâneos) |
| localStorage vs VPS | Sync API FASE 2; jobs continuam server-side |
| Scene count > 5 | Aumentar limites + testes de quota GCP |

---

## 10. Ficheiros a criar/modificar por fase

| Fase | Backend | Frontend |
|------|---------|----------|
| 1 | — | `index.html`, `styles.css`, `js/*` |
| 2 | `project-store.js`, routes `/api/projects` | sync projects |
| 3 | `asset-store.js`, upload, `generateSceneImage()` | image grid, upload UI |
| 4 | `animateScene()`, job types | Animate All UI |
| 5 | timeline metadata | `timeline.js` |
| 6 | version store, partial regen | scene editor drawer |
| 7 | `rebuildFinal()` | Rebuild button |
