# ECOOM DIRECT ADS — EVOLUÇÃO PARA CREATIVE STUDIO

> Especificação completa de produto (Agosto 2026).  
> Plano técnico: `ARQUITETURA-MIGRACAO.md`

---

## CONTEXTO

Estamos a evoluir a aplicação existente **Ecoom Direct ADS** de um MVP de geração automática de anúncios para um verdadeiro **Creative Studio de Direct Response**.

A aplicação actual já possui um pipeline funcional:

```text
Brief → Gemini storyboard → geração de imagens → Veo → clips → ffmpeg → MP4 final → copy
```

Também já existem API, jobs, batch, continuidade visual entre cenas, áudio nativo Veo, Vercel + VPS + Google Cloud e frontend funcional.

**NÃO devemos destruir ou reescrever o pipeline existente sem necessidade.**

---

## 1. NOVA VISÃO DO PRODUTO

De formulário simples para **Creative Studio**: projetos, assets, canvas, timeline, edição/regeneração parcial.

Inspiração: Google Flow — **sem copiar**. Orientado a Direct Response, UGC, Meta/TikTok/Reels.

---

## 2. DIFERENCIAL ABSOLUTO

**GERAR MUITAS IMAGENS → ANIMAR TODAS → CORTAR → UNIFICAR → EXPORTAR**

Uma descrição → dezenas de imagens → dezenas de clips → timeline → MP4 final.

---

## 3. MASTER CREATIVE PROMPT

Core do produto. Preservar sempre no projecto. IA extrai objetivo, oferta, persona, idioma, tom, cenas, hooks, CTA, prompts.

---

## 4. GLOBAL CREATIVE SETTINGS

Manter: formato, resolução, duração/clip, idioma, variante, estilo, tom.

**Novo:** duração total (15s–3min+) com cálculo automático de cenas. Editável manualmente.

---

## 5–7. ESTRUTURA + PROJECTS + CREATE

Sidebar: New Project, Projects, Library, Templates, Settings, Account.

Project: Master Prompt, Settings, Storyboards, Images, Videos, Scenes, Timeline, Exports.

**Create Ad** = pipeline completo existente.

---

## 8–11. ASSETS + IMAGENS + CONTINUIDADE

Imagens como assets persistentes. Generate N. Prompts automáticos por cena. Continuidade UGC.

---

## 12–15. SCENES + ANIMATE ALL + TIMELINE

Cena = unidade central. **Animate All** via fila de jobs. Smart Timeline.

---

## 16–21. REGENERAÇÃO PARCIAL

Regenerar só imagem ou vídeo. Dependency graph. Rebuild final sem Veo desnecessário. Versionamento V1/V2/V3. Estados claros.

---

## 22–26. UX + DESIGN + PRESERVAR EXISTENTE

Fluxo: Project → Master Prompt → Generate → Blueprint → Images → Animate All → Timeline → Export.

Dark premium UI. Backend existente reutilizado.

---

## 27–30. DATA MODEL + CUSTOS + BATCH + EXPORT

```text
Project → Creative → Scenes → Assets → Generations → Timeline → Export
```

Cost-aware. Batch na mesma pipeline.

---

## 31–33. IMPLEMENTAÇÃO

Analisar repo → migrar incrementalmente.

| Fase | Conteúdo |
|------|----------|
| **1** | App shell, sidebar, projects, design ✅ |
| **2** | Project workspace, API projects |
| **3** | Image workflow, assets, upload |
| **4** | Animate, Animate All |
| **5** | Timeline |
| **6** | Regeneração parcial |
| **7** | Final rebuild + export |

### Regra central

> *"Eu descrevo o anúncio. O Ecoom constrói-o."*  
> *"Não gostei desta parte? Altero só esta parte."*

---

Ver documento original completo na conversa / pedir export PDF se necessário.
