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
