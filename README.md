# Ecoom Direct ADS — Veo

Gera vídeos com **Google Veo** via API oficial (Vertex AI).

---

## Para ti (3 passos, sem saber programar)

### 1. Setup (só uma vez)

Abre o terminal **nesta pasta** e corre:

```bash
npm run setup
```

- Instala o que falta
- Abre o **browser** → faz login Google (conta com os $300)
- Cria projecto + bucket automaticamente
- Se pedir billing, activa o trial em: [Google Cloud Billing](https://console.cloud.google.com/billing)

### 2. Verificar

```bash
npm run check
```

Se aparecer tudo ✅, estás pronto.

### 3. Gerar vídeo

```bash
npm run video -- "Descreve o vídeo que queres, ex: anúncio de curso online, urgente, 9:16"
```

O MP4 fica em `output/`.

---

## Gerar anúncio completo (automático)

Descreve a oferta → Gemini storyboard → Gemini Image (3 imgs) → Veo 10s/clip → 1 MP4

Usa as mesmas credenciais Google Cloud (Vertex AI) — não precisas de OpenAI.

```bash
npm run ad -- --duration 10 --lang pt --format 9:16 --resolution 1080p --tone urgente \\
  "Curso Facebook Ads. 297€. Donos de loja 25-45 anos."
```

Opções (futuros cards na plataforma):

| Flag | Valores | Default |
|------|---------|---------|
| `--lang` | pt, en, es, fr | pt |
| `--format` | 9:16, 16:9 | 9:16 |
| `--duration` | 4, 6, 8, **10** | 10 |
| `--scenes` | 2–5 | 3 |
| `--resolution` | 720p, 1080p | 1080p |
| `--tone` | urgente, premium, amigavel, profissional | urgente |

1. Corre:
   ```bash
   npm run ad -- "Curso Facebook Ads para e-commerce. Preço 297€. Público: donos de loja 25-45 anos. Tom: urgente, directo."
   ```

2. Output:
   - `output/anuncio-XXXX.mp4` — vídeo final
   - `prompts/storyboard-XXXX.json` — storyboard Gemini
   - `output/copy-XXXX.json` — copy para voiceover (ElevenLabs, fase 5)
   - `assets/run-XXXX/` — imagens geradas

Só storyboard (sem gastar imagens/Veo):
```bash
npm run storyboard -- "A tua oferta..."
```

---

## Gerar vídeo com 3 imagens animadas → 1 MP4

1. Coloca 3 imagens em `assets/` (ex: `cena1.png`, `cena2.png`, `cena3.png`)
2. Edita `prompts/sequencia-exemplo.json` (caminhos + prompt de movimento por cena)
3. Corre:

```bash
npm run sequence
```

Ou directo na linha de comandos:

```bash
npm run sequence -- ./assets/cena1.png "zoom lento cinematico" ./assets/cena2.png "produto gira devagar" ./assets/cena3.png "pessoa sorri natural"
```

Output: `output/anuncio-3-cenas.mp4` (+ clips individuais em `output/scenes/`)

---

## Gerar vários vídeos (só texto)

```bash
npm run video:batch
```

Usa os prompts em `prompts/exemplo.json` (podes editar).

---

## O Cursor / AI agent

Depois do `npm run setup`, o ficheiro `.env` existe e o MCP Vertex AI em `.cursor/mcp.json` fica activo.

**Reinicia o Cursor** → Settings → MCP → liga **vertex-ai**.

A partir daí podes pedir no chat: *"Gera um vídeo Veo com este prompt..."*

---

## Deploy (VPS + GitHub + Vercel)

Repositório: **https://github.com/joaoecoom/ecoom-direct-ads**

Frontend: **https://web-liard-pi-k8e9ujwuis.vercel.app**

### CI/CD (GitHub Actions)

| Workflow | Trigger | O quê faz |
|----------|---------|-----------|
| `deploy-vercel.yml` | push `main` (web/) | Deploy frontend Vercel |
| `deploy-vps.yml` | push `main` (server/, src/) | `git pull` + PM2 na Contabo |

**Secrets GitHub** (Settings → Secrets → Actions) — já configurados:

| Secret | Valor |
|--------|-------|
| `VPS_HOST` | IP Contabo |
| `VPS_USER` | root |
| `VPS_PASSWORD` | *(password VPS)* |
| `VERCEL_ORG_ID` | team id |
| `VERCEL_PROJECT_ID` | project id |

**Falta 1 secret manual:** `VERCEL_TOKEN` — cria em [vercel.com/account/tokens](https://vercel.com/account/tokens) e adiciona no GitHub. Depois disso, cada push a `main` faz deploy automático.

### Arquitectura

```
Vercel (frontend web/)  →  VPS (API server/)  →  Google Veo / Gemini
```

### 1. GitHub — feito

Código em `joaoecoom/ecoom-direct-ads`.

### 2. VPS — API (corre o pipeline)

Na VPS (Ubuntu):

```bash
git clone https://github.com/joaoecoom/ecoom-direct-ads.git /opt/ecoom-direct-ads
cd /opt/ecoom-direct-ads
cp .env.example .env
# Edita .env com GCP + FRONTEND_URL
# Coloca service account JSON e define:
# GOOGLE_APPLICATION_CREDENTIALS=/opt/ecoom-direct-ads/gcp-sa.json

npm install
bash scripts/deploy-vps.sh
```

Expõe a porta **8787** (nginx reverse proxy recomendado → `https://api.teu-dominio.com`).

Teste: `curl https://api.teu-dominio.com/health`

### 3. Vercel — frontend

Frontend estático em `web/` — **já deployado**:

- **https://web-liard-pi-k8e9ujwuis.vercel.app**

Antes de usar, aponta a API:

```bash
ECOOM_API_URL=https://api.teu-dominio.com bash scripts/inject-api-url.sh
cd web && vercel deploy --prod
```

Ou edita `web/config.js` manualmente:

```js
window.ECOOM_API_URL = "https://api.teu-dominio.com";
```

No `.env` da VPS:

```
FRONTEND_URL=https://web-liard-pi-k8e9ujwuis.vercel.app
```

---

## Custos

Usa os **$300 grátis** do Google Cloud (90 dias). Cada clip Veo ~$0,24–0,80 (8s, conforme modelo).

---

## Problemas comuns

| Erro | Solução |
|------|---------|
| `Could not load default credentials` | `npm run setup` de novo |
| `Billing not enabled` | Activa billing no GCP Console |
| `403` / `Permission denied` | Espera 2 min após activar APIs |
| MCP não funciona | Reinicia Cursor; confirma `.env` existe |
