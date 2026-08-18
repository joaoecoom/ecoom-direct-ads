import { createClient } from "./veo-client.js";
import { formatAdConfigSummary, resolveAdConfig } from "./ad-config.js";

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

/**
 * Gera copy de anúncio direct response a partir do brief estruturado.
 * A duração e número de cenas ficam para a fase storyboard.
 */
export async function generateAdCopy({ offer, overrides = {}, wizard = {} }) {
  const adConfig = resolveAdConfig({
    ...overrides,
    sceneCount: overrides.sceneCount || 3,
  });

  const model = process.env.GEMINI_COPY_MODEL || process.env.GEMINI_STORYBOARD_MODEL || "gemini-2.5-flash";
  const client = createClient();

  const langNote =
    adConfig.languageVariant === "pt-PT"
      ? "PORTUGUÊS DE PORTUGAL (PT-PT)"
      : adConfig.languageVariant === "pt-BR"
        ? "PORTUGUÊS DO BRASIL (PT-BR)"
        : adConfig.languageLabel;

  const systemPrompt = `És copywriter sénior de anúncios Direct Response para vídeo (${adConfig.style === "ugc" ? "UGC talking head" : "performance AIDA"}).

IDIOMA OBRIGATÓRIO: ${langNote}
TOM: ${adConfig.tone}
FORMATO: ${adConfig.aspectRatio}

Gera copy pronta para ser gravada em vídeo curto. Se o brief mencionar duração (~30s, ~60s, etc.), calibra o tamanho do voiceover — NÃO inventes números de cenas.

Responde APENAS JSON:
{
  "title": "título interno",
  "hook": "abertura max 12 palavras",
  "voiceover": "script completo falado, fluído, pronto a gravar",
  "cta": "call to action final",
  "targetDurationSeconds": number or null,
  "persona": "quem fala / quem é o público",
  "product": "o que se vende",
  "keyPoints": ["bullet 1", "bullet 2"]
}`;

  const wizardBlock = wizard.persona
    ? `\n\nPersona: ${wizard.persona}\nProduto: ${wizard.product || ""}\nObjetivo: ${wizard.goal || ""}\nCTA desejado: ${wizard.cta || ""}\nDuração desejada: ${wizard.durationHint || "não especificada — tu decides pelo copy"}`
    : "";

  const userPrompt = `Brief:\n${offer}${wizardBlock}\n\nGera a copy completa.`;

  console.log("\n✍️  Gemini a gerar copy...");
  console.log(`   ${formatAdConfigSummary(adConfig)}\n`);

  const response = await client.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      temperature: 0.55,
    },
  });

  const raw = response.text;
  if (!raw) throw new Error("Gemini não devolveu copy.");

  const copy = parseJsonResponse(raw);
  if (!copy.voiceover?.trim()) {
    throw new Error("Copy inválida: falta voiceover.");
  }

  return {
    ...copy,
    language: adConfig.language,
    languageVariant: adConfig.languageVariant,
    style: adConfig.style,
    tone: adConfig.tone,
    generatedAt: new Date().toISOString(),
    model,
  };
}
