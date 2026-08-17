# Ecoom Direct ADS — Resumo da Aplicação

> Documento de contexto para evolução do produto (GPT, stakeholders, roadmap).  
> Última actualização: Agosto 2026

---

## 1. O que é

**Ecoom Direct ADS** é uma plataforma de geração automática de **anúncios em vídeo estilo UGC** (User Generated Content) para performance marketing (Meta, TikTok, Reels, YouTube Shorts).

O utilizador escreve um **brief da oferta** (produto, preço, público, tom) e o sistema gera:

1. **Storyboard** (roteiro + prompts por cena)
2. **Imagens** humanizadas da mesma “persona”
3. **Clips de vídeo** animados com Google Veo
4. **MP4 final** concatenado
5. **Copy** (hook, CTA, voiceover por cena)

**Objetivo de negócio:** permitir à agência/marca **Ecoom** criar dezenas de criativos de anúncio rapidamente, sem equipa de produção, usando IA generativa.

---

## 2. Fluxo do utilizador (produto)

1. Abre o frontend web
2. Cola o brief: *"Suplemento vitamina D, médico amigável, UGC, inverno..."*
3. Escolhe: idioma, variante, formato (9:16 / 16:9), nº de cenas (1–5), duração por clip (4–10s), resolução (720p/1080p)
4. Clica **Gerar anúncio**
5. Vê progresso em tempo real (storyboard → imagens → vídeo → copy)
6. Descarrega o MP4 + copy para usar nos ads

**Modo batch:** enviar 5–20 briefs de uma vez; a API processa em fila (1 job de cada vez).

---

## 3. Pipeline técnico (automático)

```
Brief → Gemini (storyboard JSON) → Imagen/Gemini Image (1ª cena + variações) → Veo 3.1 (clips) → concat MP4 → copy JSON
```

### Passo a passo

| Etapa | O quê | Tecnologia |
|-------|--------|------------|
| 1. Storyboard | Gemini gera JSON estruturado: título, hook, CTA, `characterBrief`, `settingBrief`, N cenas com `voiceoverLine`, `imagePrompt`, `motionPrompt` | Gemini via Vertex AI |
| 2. Imagens | Cena 1: imagem nova UGC. Cenas 2–N: **variação** da mesma pessoa (continuidade visual) | Gemini Image / Imagen |
| 3. Vídeo | Cada imagem → clip Veo com motion prompt + diálogo embutido | Veo 3.1 (`veo-3.1-generate-001`) |
| 4. Montagem | Concatena clips; em UGC multi-cena usa **flow** com crossfade (~0.35s) | ffmpeg local |
| 5. Áudio | Modo actual: **áudio nativo Veo** (persona fala à câmara) | Veo `generateAudio: true` |
| 6. Output | `output/anuncio-XXXX.mp4`, `prompts/storyboard-XXXX.json`, `output/copy-XXXX.json`, `assets/run-XXXX/` | filesystem |

### Estilos suportados

- **`ugc`** — talking head, mesma pessoa, selfie/consultório, continuidade entre cenas
- **`ad`** — anúncio performance clássico (AIDA), menos foco em persona fixa

### Opções configuráveis

| Opção | Valores |
|-------|---------|
| Idiomas | PT, EN, ES, FR |
| Variantes | `pt-BR`, `pt-PT`, `en`, `en-US`, `en-GB`, etc. |
| Formatos | 9:16 (Stories/Reels), 16:9 (YouTube) |
| Cenas | 1–5 |
| Duração/clip | 4, 6, 8 ou 10 segundos |
| Resolução | 720p ou 1080p |
| Tom | urgente, premium, amigável, profissional |

---

## 4. Arquitetura em produção

```
Browser → Vercel (frontend estático) → proxy /api/* → VPS Contabo (Express API) → Google Cloud (Gemini + Veo + GCS)
```

| Componente | URL / detalhe |
|------------|---------------|
| **Frontend** | https://ecoom-direct-ads.vercel.app |
| **API (VPS)** | Contabo Cloud VPS 4 (4 vCPU, 8GB) — IP `169.58.195.244`, nginx :80 → Express :8787 |
| **Repo** | https://github.com/joaoecoom/ecoom-direct-ads |
| **GCP** | Projecto Vertex AI, bucket GCS para output Veo, trial $300 |
| **CI/CD** | GitHub Actions: deploy Vercel (frontend) + deploy VPS (API/pipeline) |

### API REST

| Endpoint | Descrição |
|----------|-----------|
| `GET /health` | Health check |
| `GET /api/config` | Opções disponíveis (idiomas, formatos, etc.) |
| `POST /api/jobs` | 1 brief → job na fila |
| `POST /api/jobs/batch` | Array de briefs (max 20) |
| `GET /api/jobs/:id` | Estado + progresso |
| `GET /api/jobs/:id/video` | Download MP4 |
| `GET /api/jobs/:id/copy` | JSON com copy |

Jobs processados **sequencialmente** (1 activo de cada vez) para controlar quotas e custos GCP.

---

## 5. Stack tecnológico

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 20+, ES modules |
| Backend | Express + CORS + fila de jobs (job-store JSON) |
| Frontend | HTML/CSS/JS vanilla (sem React/Next) |
| Deploy | Vercel (static) + PM2 na VPS + nginx |
| IA | `@google/genai`, Vertex AI Veo 3.1, Gemini (storyboard), Gemini Image |
| Mídia | ffmpeg (concat, mix áudio) |
| TTS (preparado) | Google TTS, ElevenLabs |
| Lip sync (preparado) | Sync Labs, DreamAPI |

---

## 6. Estado actual vs. planeado

### Funciona hoje

- Pipeline completo CLI + API + frontend web
- UGC multi-cena com continuidade visual (mesma persona)
- PT-BR e English via **áudio nativo Veo** (sem lip sync externo)
- Deploy no ar (Vercel + VPS)
- Batch de jobs
- Teste local bem-sucedido (~3.7 min para 1 cena PT-BR)

### Parcialmente implementado

- **PT-PT europeu:** código existe (TTS externo + lip sync) mas **não está activo** — Veo tende a falar PT-BR; lip sync real exige ElevenLabs/Google TTS + DreamAPI/Sync Labs (~2 créditos/vídeo)
- Domínio custom (ex. `ads.ecoom.pt`) — ainda usa subdomínio Vercel
- HTTPS na VPS — API exposta em HTTP (Vercel faz proxy HTTPS→HTTP)

### Ainda não existe

- Autenticação / multi-utilizador / billing por crédito
- Dashboard de histórico de criativos
- Editor visual de storyboard antes de gerar
- A/B variants automáticos (5 hooks diferentes do mesmo brief)
- Integração directa Meta Ads / TikTok upload
- Templates por vertical (e-commerce, infoproduto, SaaS, local business)
- Preview rápido (storyboard + imagens antes de gastar Veo)
- Webhooks / notificação quando job termina

---

## 7. Limitações conhecidas

1. **Voz PT-PT** — Veo gera áudio com sotaque BR; solução real = TTS PT-PT + lip sync pós-produção
2. **Custo por vídeo** — cada clip Veo ~$0.24–0.80 (8s); 3 cenas ≈ $1–2+ só em Veo
3. **Tempo** — 1 cena ~3–4 min; 3 cenas pode levar 10–15+ min
4. **Fila única** — 1 job de cada vez na VPS
5. **Continuidade** — boa mas não perfeita; por vezes há drift visual entre cenas
6. **Sem guardrails de brand** — não há upload de logo, cores, ou guidelines da marca
7. **Credenciais GCP** — usa ADC (Application Default Credentials), não service account JSON (bloqueado por org policy)

---

## 8. Modelo de custos

| Item | Custo |
|------|-------|
| Trial Google Cloud | $300 / 90 dias |
| Veo 3.1 | ~$0.24–0.80 por clip de 8s |
| Gemini storyboard + imagens | Custo menor mas acumula |
| VPS Contabo | ~€6–8/mês |
| Vercel | Free tier |

---

## 9. Público-alvo

- Agência de performance marketing (**Ecoom**)
- Donos de e-commerce / infoprodutores que precisam de **volume de criativos UGC**
- Mercado PT/BR inicialmente; expansão EN/ES

---

## 10. Exemplo de input (brief típico)

```
Suplemento de vitamina D para energia e imunidade no inverno.
Público: adultos 30-55 anos preocupados com fadura sazonal.
Tom: amigável, médico de confiança falando à câmara.
Preço: 29€. CTA: experimenta 30 dias.
Formato UGC selfie, consultório moderno.
```

---

## 11. Perguntas para evolução do produto

Estamos a construir uma ferramenta interna/produto SaaS para gerar anúncios UGC em vídeo automaticamente. Queremos evoluir de MVP técnico para **produto comercial forte**.

### UX/UI

- Como deve ser o fluxo ideal? (wizard, templates, preview antes de gastar, editor de storyboard)

### Funcionalidades killer

- O que diferencia isto de HeyGen, Arcads, Creatify, etc.?

### Monetização

- Créditos por cena? Planos? White-label para agências?

### Qualidade criativa

- Como garantir hooks melhores, menos “AI slop”, mais conversão?

### PT-PT

- Melhor arquitectura: Veo silent + TTS + lip sync vs. outros modelos?

### Escala

- Fila paralela, workers, cache de personas, reutilizar avatar?

### Integrações

- Meta Marketing API, biblioteca de criativos, A/B testing

### Roadmap

- O que fazer nas próximas 4 semanas vs. 3 meses?

---

## 12. Estrutura do repositório

```
ecoom-direct-ads/
├── src/
│   ├── run-ad-generation.js    # Pipeline principal (reutilizado pela API)
│   ├── generate-ad.js          # CLI
│   ├── lib/
│   │   ├── storyboard.js       # Prompt Gemini + schema JSON
│   │   ├── imagen.js           # Geração de imagens UGC
│   │   ├── veo-client.js       # Cliente Veo Vertex AI
│   │   ├── ad-config.js        # Opções (idioma, formato, tom, etc.)
│   │   ├── tts.js              # TTS (ElevenLabs / Google)
│   │   └── lipsync.js          # Lip sync (Sync Labs / DreamAPI)
│   └── generate-sequence.js    # Animação + concat clips
├── server/
│   ├── index.js                # API Express + fila
│   └── job-store.js            # Persistência de jobs
├── web/
│   ├── index.html              # Frontend
│   ├── app.js
│   ├── styles.css
│   └── config.js               # URL da API (proxy Vercel)
├── vercel.json                 # Deploy + proxy API → VPS
├── ecosystem.config.cjs        # PM2 na VPS
└── .github/workflows/          # CI/CD
```

---

## 13. Links úteis

- **App:** https://ecoom-direct-ads.vercel.app
- **GitHub:** https://github.com/joaoecoom/ecoom-direct-ads
- **API health:** https://ecoom-direct-ads.vercel.app/health

---

*Documento gerado para partilha com GPT / equipa / investidores.*
