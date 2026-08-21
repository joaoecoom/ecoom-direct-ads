import { createClient } from "./veo-client.js";
import { resolveAdConfig } from "./ad-config.js";
import { getStoryboardCreativeRules } from "./creative-format.js";
import { buildFlowMotionPrompt } from "./image-prompts.js";
import { enrichStoryboardProductionMeta } from "./scene-classification.js";

function buildStoryboardSchema(config) {
  const base = {
    title: "string — título interno do anúncio",
    hook: "string — frase de abertura (max 12 palavras)",
    cta: "string — call to action final",
    voiceover: `string — script COMPLETO em PT-PT se aplicável, calibrado para ~${config.totalDurationSeconds}s`,
    config: {
      language: config.language,
      languageVariant: config.languageVariant,
      aspectRatio: config.aspectRatio,
      clipDurationSeconds: config.clipDurationSeconds,
      sceneCount: config.sceneCount,
      resolution: config.resolution,
      tone: config.tone,
      style: config.style,
      totalDurationSeconds: config.totalDurationSeconds,
    },
    scenes: [
      {
        id: "parte-1 | parte-2 | ...",
        role: "função narrativa desta cena",
        onScreenText: "subtítulo curto PT-PT ou vazio",
        voiceoverLine: "O que a pessoa DIZ nesta parte — PT-PT europeu, vocabulário de Portugal",
        visualBeat:
          "EN — só o que muda nesta cena: expressão, gesto, postura (continuação do discurso)",
        sceneType: "ugc | broll | react_overlay — tipo de plano",
        sceneProductionClass:
          "UGC | BROLL | PRODUCT | HERO | BACKGROUND | FOOD | SCREEN | MOTION_GRAPHIC | TESTIMONIAL | TRANSITION | OTHER",
        sceneQualityRequirement: "LOW | MEDIUM | HIGH | PREMIUM",
        editingNotes: "notas de edição: whoosh no corte, zoom, etc. (opcional)",
        imagePrompt:
          "prompt EN: characterBrief + settingBrief + visualBeat desta cena",
        motionPrompt:
          "prompt EN: talking head + visualBeat, continuação natural, preserve identity",
      },
    ],
  };

  if (config.style === "ugc") {
    base.characterBrief =
      "string EN — protagonista FIXO (idade, género, cabelo, roupa, acessórios)";
    base.settingBrief =
      "string EN — cenário FIXO (consultório, luz, decoração, ângulo selfie UGC)";
  }

  return base;
}

function getLanguageCopyRules(config) {
  const { languageVariant, clipDurationSeconds } = config;

  if (languageVariant === "pt-PT") {
    return `
IDIOMA — PORTUGUÊS DE PORTUGAL (PT-PT):
- Vocabulário europeu: "consulta", "médico", "alimentação", "glicose"
- voiceoverLine: máx ~18 palavras por clip de ${clipDurationSeconds}s`;
  }

  if (languageVariant === "pt-BR" || (config.language === "pt" && languageVariant !== "pt-PT")) {
    return `
IDIOMA — PORTUGUÊS DO BRASIL (PT-BR):
- Vocabulário brasileiro natural e conversacional
- voiceoverLine: máx ~18 palavras por clip de ${clipDurationSeconds}s`;
  }

  if (config.language === "en") {
    return `
LANGUAGE — ENGLISH:
- Natural conversational English, short punchy lines
- voiceoverLine: max ~18 words per ${clipDurationSeconds}s clip`;
  }

  return `
IDIOMA: ${config.languageLabel} (${languageVariant})
- voiceoverLine calibrada para ${clipDurationSeconds}s por clip`;
}

function getStyleRules(config) {
  const { clipDurationSeconds, aspectRatio } = config;
  const langRules = getLanguageCopyRules(config);

  if (config.style === "ugc") {
    const flowNote =
      config.sceneCount === 1
        ? `
MODO TESTE — 1 CENA ONLY:
- Apenas 1 scene no array
- voiceoverLine: 1 frase curta (máx 18 palavras) para ${clipDurationSeconds}s
- imagePrompt: máximo realismo humano, anti-AI face`
        : `
MODO UGC — FLOW CONTÍNUO (${config.sceneCount} imagens DIFERENTES, mesma pessoa):`;

    return `
${flowNote}
${langRules}

1. characterBrief + settingBrief: FIXOS em todas as cenas

2. Cada cena = imagem DIFERENTE mas CONTINUAÇÃO do mesmo vídeo (se >1 cena):
   - visualBeat: descreve APENAS evolução (expressão/gesto) — NÃO mudar pessoa/roupa/sala

3. QUALIDADE HUMANA (Nano Banana Pro) — CRÍTICO:
   - Real human, NOT AI face, visible pores, asymmetric features, natural imperfections
   - iPhone selfie, slight grain, NOT plastic/CGI/stock photo/beauty filter

4. imagePrompt = characterBrief + settingBrief + visualBeat

5. motionPrompt: APENAS movimento visual em EN — SEM diálogo, SEM texto falado
   - Ex: "subtle lip movement, natural head nod, preserve identity"

6. voiceoverLine + voiceover: idioma correcto (${config.languageVariant || config.language}) — diálogo vai para Veo áudio nativo`;
  }

  return `MODO ANÚNCIO: imagePrompt detalhado EN, motionPrompt com "for a ${clipDurationSeconds} second clip"`;
}

function parseJsonResponse(raw) {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const cleaned = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    return JSON.parse(cleaned);
  }
}

function assignSceneTypes(storyboard, config) {
  const scenes = storyboard.scenes || [];
  const ratio = config.brollRatio || "medium";
  const brollEvery = ratio === "high" ? 2 : ratio === "low" ? 5 : 3;
  const fmt = config.videoFormat || "talking_head";

  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].sceneType) continue;

    if (fmt === "ugc_react") {
      scenes[i].sceneType = i > 0 && i % 4 === 3 ? "react_overlay" : "ugc";
    } else if (fmt === "ugc_broll" || fmt === "mixed") {
      scenes[i].sceneType = i > 0 && i % brollEvery === brollEvery - 1 ? "broll" : "ugc";
    } else if (fmt === "ugc_demo") {
      scenes[i].sceneType = "ugc";
      if (!scenes[i].visualBeat?.includes("product")) {
        scenes[i].visualBeat = `${scenes[i].visualBeat || ""} Holding/showing product naturally.`.trim();
      }
    } else {
      scenes[i].sceneType = "ugc";
    }
  }
}

function applyUgcRules(storyboard, config) {
  if (config.style !== "ugc") {
    return enrichStoryboardProductionMeta(storyboard);
  }

  assignSceneTypes(storyboard, config);

  const brief = [storyboard.characterBrief, storyboard.settingBrief]
    .filter(Boolean)
    .join(". ")
    .trim();

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const beat = scene.visualBeat || scene.role || `scene ${i + 1} continuation`;
    const n = storyboard.scenes.length;

    if (!scene.sceneType) {
      scene.sceneType = "ugc";
    }

    if (scene.sceneType === "broll" && !scene.onScreenText) {
      scene.onScreenText = "";
    }
    if (scene.sceneType === "react_overlay") {
      scene.motionPrompt =
        scene.motionPrompt ||
        "Person reacts to phone screen content with surprised/engaged expression, glances at overlay, preserve identity, UGC selfie.";
    }
    if (scene.sceneType === "broll") {
      scene.motionPrompt =
        scene.motionPrompt ||
        "Slow cinematic push-in, product/lifestyle B-roll, shallow depth of field, no talking head, smooth motion.";
      scene.voiceoverLine = scene.voiceoverLine || "";
    }

    if (brief && scene.sceneType === "ugc" && !scene.imagePrompt.toLowerCase().includes(brief.slice(0, 30).toLowerCase())) {
      scene.imagePrompt = `${brief}. Scene ${i + 1} of ${n} in continuous UGC video. ${beat}. ${scene.imagePrompt}`;
    }

    if (i === 0 && config.hookStyle) {
      scene.role = scene.role || `Hook — ${config.hookStyle}`;
    }

    if (config.editSfx && config.editSfx !== "none" && !scene.editingNotes) {
      scene.editingNotes = `Cut transition: ${config.editSfx}`;
    }

    if (!scene.motionPrompt || scene.motionPrompt.length < 40) {
      const bridging = i < storyboard.scenes.length - 1;
      scene.motionPrompt = buildFlowMotionPrompt(
        config.clipDurationSeconds,
        scene.visualBeat || scene.role,
        { bridging },
      );
    } else if (i < storyboard.scenes.length - 1) {
      scene.motionPrompt = `${scene.motionPrompt} Smooth transition into next beat — no hard cut, continuous take feel.`;
    }
  }

  return enrichStoryboardProductionMeta(storyboard);
}

export async function generateStoryboard({ offer, adConfig: adConfigOverrides = {} }) {
  const adConfig = resolveAdConfig(adConfigOverrides);
  const {
    sceneCount,
    language,
    languageLabel,
    aspectRatio,
    clipDurationSeconds,
    tone,
    totalDurationSeconds,
    style,
    languageVariant,
  } = adConfig;

  const model =
    process.env.GEMINI_STORYBOARD_MODEL || "gemini-2.5-flash";
  const client = createClient();
  const schema = buildStoryboardSchema(adConfig);
  const styleRules = getStyleRules(adConfig);
  const creativeRules = getStoryboardCreativeRules(adConfig);

  const langNote =
    languageVariant === "pt-PT"
      ? "OBRIGATÓRIO: PORTUGUÊS DE PORTUGAL (PT-PT) — copy E voiceoverLine."
      : languageVariant === "pt-BR"
        ? "OBRIGATÓRIO: PORTUGUÊS DO BRASIL (PT-BR) — copy E voiceoverLine."
        : languageVariant === "en" || language === "en"
          ? "REQUIRED: ENGLISH — copy AND voiceoverLine."
          : `${languageLabel} (${languageVariant})`;

  const systemPrompt = `És um diretor criativo sénior de vídeos UGC para redes sociais.

PARÂMETROS FIXOS:
- Idioma: ${langNote}
- Formato: ${aspectRatio}
- Duração CADA clip: ${clipDurationSeconds}s
- Total: ${totalDurationSeconds}s = ${sceneCount} cenas
- Resolução: ${adConfig.resolution}
- Tom: ${tone}
- Estilo: ${style}

${styleRules}

${creativeRules}

Responde APENAS JSON válido:
${JSON.stringify(schema, null, 2)}`;

  const userPrompt =
    sceneCount === 1
      ? `Brief:\n${offer}\n\nGera storyboard com 1 cena × ${clipDurationSeconds}s (teste rápido). voiceoverLine curta.`
      : `Brief:\n${offer}\n\nGera storyboard (${sceneCount} cenas × ${clipDurationSeconds}s, flow contínuo).`;

  console.log("\n🧠 Gemini a gerar storyboard...");
  console.log(`   Modelo: ${model}`);
  console.log(
    `   ${languageLabel}${languageVariant ? ` (${languageVariant})` : ""} · ${aspectRatio} · ${clipDurationSeconds}s/clip · ${style}\n`,
  );

  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      temperature: 0.45,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini não devolveu conteúdo.");

  let storyboard = parseJsonResponse(raw);
  if (!storyboard.scenes?.length) {
    throw new Error("Storyboard inválido: falta array scenes.");
  }

  storyboard = applyUgcRules(storyboard, adConfig);

  storyboard.config = {
    ...adConfig,
    clipDurationSeconds: adConfig.clipDurationSeconds,
    totalDurationSeconds: adConfig.totalDurationSeconds,
    sceneCount: adConfig.sceneCount,
    style: adConfig.style,
  };
  storyboard.aspectRatio = adConfig.aspectRatio;
  storyboard.durationSeconds = adConfig.clipDurationSeconds;
  storyboard.totalDurationSeconds = adConfig.totalDurationSeconds;
  storyboard.resolution = adConfig.resolution;
  storyboard.language = adConfig.language;
  storyboard.languageVariant = adConfig.languageVariant;
  storyboard.tone = adConfig.tone;
  storyboard.style = adConfig.style;
  storyboard.postProduction = {
    captions: adConfig.captions,
    captionStyle: adConfig.captions,
    backgroundMusic: adConfig.backgroundMusic,
    editSfx: adConfig.editSfx,
    videoFormat: adConfig.videoFormat,
    ugcSetting: adConfig.ugcSetting,
  };
  storyboard.generatedAt = new Date().toISOString();
  storyboard.offer = offer;
  storyboard.model = model;

  console.log("✅ Storyboard gerado:");
  console.log(`   Título: ${storyboard.title}`);
  if (storyboard.characterBrief) {
    console.log(`   Personagem: ${storyboard.characterBrief.slice(0, 70)}...`);
  }
  console.log(`   Cenas: ${storyboard.scenes.length} × ${adConfig.clipDurationSeconds}s\n`);

  return storyboard;
}

function normalizeStoryboardTiming(storyboard, adConfig) {
  const scenes = storyboard.scenes || [];
  const clipDuration =
    storyboard.clipDurationSeconds ||
    storyboard.config?.clipDurationSeconds ||
    adConfig.clipDurationSeconds ||
    8;

  storyboard.scenes = scenes.map((s, i) => ({
    ...s,
    id: s.id || `parte-${i + 1}`,
    clipDurationSeconds: s.clipDurationSeconds || clipDuration,
  }));

  const sceneCount = storyboard.scenes.length;
  storyboard.config = {
    ...adConfig,
    ...storyboard.config,
    sceneCount,
    clipDurationSeconds: clipDuration,
    totalDurationSeconds: sceneCount * clipDuration,
    style: adConfig.style,
  };
  storyboard.aspectRatio = adConfig.aspectRatio;
  storyboard.durationSeconds = clipDuration;
  storyboard.totalDurationSeconds = sceneCount * clipDuration;
  storyboard.resolution = adConfig.resolution;
  storyboard.language = adConfig.language;
  storyboard.languageVariant = adConfig.languageVariant;
  storyboard.tone = adConfig.tone;
  storyboard.style = adConfig.style;

  return storyboard;
}

/**
 * Storyboard a partir de copy aprovada — IA decide cenas, duração/clip e prompts por cena.
 */
export async function generateStoryboardFromCopy({
  offer,
  copy,
  adConfig: adConfigOverrides = {},
}) {
  const adConfig = resolveAdConfig({
    ...adConfigOverrides,
    sceneCount: adConfigOverrides.sceneCount || 3,
  });

  const model =
    process.env.GEMINI_STORYBOARD_MODEL || "gemini-2.5-flash";
  const client = createClient();
  const styleRules = getStyleRules(adConfig);
  const creativeRules = getStoryboardCreativeRules(adConfig);

  const langNote =
    adConfig.languageVariant === "pt-PT"
      ? "OBRIGATÓRIO: PORTUGUÊS DE PORTUGAL (PT-PT)"
      : adConfig.languageVariant === "pt-BR"
        ? "OBRIGATÓRIO: PORTUGUÊS DO BRASIL (PT-BR)"
        : adConfig.languageLabel;

  const targetDuration =
    copy.targetDurationSeconds ||
    (copy.voiceover ? Math.ceil(copy.voiceover.split(/\s+/).length / 2.5) : null);

  const systemPrompt = `És director criativo de vídeos UGC Direct Response.

COPY JÁ APROVADA — não reescrevas o argumento principal, apenas divide em cenas filmáveis.

IDIOMA voiceoverLine: ${langNote}
FORMATO: ${adConfig.aspectRatio} · Resolução: ${adConfig.resolution}
ESTILO: ${adConfig.style} · TOM: ${adConfig.tone}
${styleRules}
${creativeRules}

REGRAS DE ESTRUTURA (TU DECIDES):
- Número de cenas: o que a copy precisar (tipicamente 3–12; mais se copy longa)
- clipDurationSeconds global: 4, 6, 8 ou 10 — o que encaixar melhor na fala
- Cada voiceoverLine deve caber confortavelmente no clip
- imagePrompt EN detalhado; motionPrompt EN só movimento visual
- Flow contínuo UGC: mesma personagem/cenário

Responde APENAS JSON:
{
  "title": "string",
  "hook": "string",
  "cta": "string",
  "voiceover": "copy completa (pode igual à aprovada)",
  "clipDurationSeconds": 8,
  "characterBrief": "EN se ugc",
  "settingBrief": "EN se ugc",
  "scenes": [
    {
      "id": "parte-1",
      "role": "hook | problema | solução | prova | cta",
      "voiceoverLine": "fala desta cena",
      "visualBeat": "EN",
      "imagePrompt": "EN",
      "motionPrompt": "EN com for a X second clip",
      "onScreenText": "PT ou vazio"
    }
  ]
}`;

  const userPrompt = `Brief original:\n${offer}\n\nCOPY APROVADA:\nTítulo: ${copy.title || ""}\nHook: ${copy.hook || ""}\nVoiceover:\n${copy.voiceover}\nCTA: ${copy.cta || ""}\n${targetDuration ? `Duração alvo ~${targetDuration}s` : ""}\n\nDivide em cenas com prompts de imagem e animação.`;

  console.log("\n🎬 Gemini a planear cenas a partir da copy...");

  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini não devolveu storyboard.");

  let storyboard = parseJsonResponse(raw);
  if (!storyboard.scenes?.length) {
    throw new Error("Storyboard inválido: falta cenas.");
  }

  storyboard = applyUgcRules(storyboard, adConfig);
  storyboard = normalizeStoryboardTiming(storyboard, {
    ...adConfig,
    clipDurationSeconds:
      storyboard.clipDurationSeconds || adConfig.clipDurationSeconds,
  });
  storyboard.generatedAt = new Date().toISOString();
  storyboard.offer = offer;
  storyboard.sourceCopy = {
    title: copy.title,
    hook: copy.hook,
    voiceover: copy.voiceover,
    cta: copy.cta,
  };
  storyboard.model = model;

  console.log(
    `✅ Storyboard: ${storyboard.scenes.length} cenas × ${storyboard.durationSeconds}s\n`,
  );

  return storyboard;
}
