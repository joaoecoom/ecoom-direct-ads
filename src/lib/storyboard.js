import { createClient } from "./veo-client.js";
import { resolveAdConfig } from "./ad-config.js";
import { buildFlowMotionPrompt } from "./image-prompts.js";

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

function applyUgcRules(storyboard, config) {
  if (config.style !== "ugc") return storyboard;

  const brief = [storyboard.characterBrief, storyboard.settingBrief]
    .filter(Boolean)
    .join(". ")
    .trim();

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const beat = scene.visualBeat || scene.role || `scene ${i + 1} continuation`;
    const n = storyboard.scenes.length;

    if (brief && !scene.imagePrompt.toLowerCase().includes(brief.slice(0, 30).toLowerCase())) {
      scene.imagePrompt = `${brief}. Scene ${i + 1} of ${n} in continuous UGC video. ${beat}. ${scene.imagePrompt}`;
    }

    if (!scene.motionPrompt || scene.motionPrompt.length < 40) {
      scene.motionPrompt = buildFlowMotionPrompt(
        config.clipDurationSeconds,
        scene.visualBeat || scene.role,
      );
    }
  }

  return storyboard;
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
