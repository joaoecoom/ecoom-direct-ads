/**
 * Constrói o brief estruturado a partir das respostas do wizard.
 * A duração e nº de cenas ficam implícitas — a IA decide na copy/storyboard.
 */

export const WIZARD_DEFAULTS = {
  product: "",
  persona: "",
  goal: "",
  style: "ugc",
  tone: "natural",
  language: "pt",
  languageVariant: "pt-BR",
  aspectRatio: "9:16",
  resolution: "720p",
  durationHint: "",
  cta: "",
  extras: "",
};

export function buildMasterPrompt(wizard) {
  const w = { ...WIZARD_DEFAULTS, ...wizard };
  const lines = [
    "# Brief criativo — Direct Response Video",
    "",
    `## Produto / oferta`,
    w.product.trim() || "(não especificado)",
    "",
    `## Persona & público`,
    w.persona.trim() || "(não especificado)",
    "",
    `## Objetivo do anúncio`,
    w.goal.trim() || "Conversão / resposta directa",
    "",
    `## Estilo & tom`,
    `- Estilo: ${w.style}`,
    `- Tom: ${w.tone}`,
    "",
    `## Formato técnico`,
    `- Proporção: ${w.aspectRatio}`,
    `- Resolução: ${w.resolution}`,
    `- Idioma: ${w.languageVariant || w.language}`,
    "",
  ];

  if (w.durationHint?.trim()) {
    lines.push(`## Duração desejada (orientativa)`, w.durationHint.trim(), "");
  }

  if (w.cta?.trim()) {
    lines.push(`## CTA desejado`, w.cta.trim(), "");
  }

  if (w.extras?.trim()) {
    lines.push(`## Notas adicionais`, w.extras.trim(), "");
  }

  lines.push(
    "---",
    "A IA deve decidir quantas cenas e duração por clip encaixam melhor nesta copy.",
  );

  return lines.join("\n");
}

export function wizardToSettings(wizard, config) {
  const w = { ...WIZARD_DEFAULTS, ...wizard };
  return {
    language: w.language,
    languageVariant: w.languageVariant,
    aspectRatio: w.aspectRatio,
    resolution: w.resolution,
    tone: w.tone,
    style: w.style,
  };
}

export function settingsToWizard(settings = {}) {
  return {
    ...WIZARD_DEFAULTS,
    language: settings.language || WIZARD_DEFAULTS.language,
    languageVariant: settings.languageVariant || WIZARD_DEFAULTS.languageVariant,
    aspectRatio: settings.aspectRatio || WIZARD_DEFAULTS.aspectRatio,
    resolution: settings.resolution || WIZARD_DEFAULTS.resolution,
    tone: settings.tone || WIZARD_DEFAULTS.tone,
    style: settings.style || WIZARD_DEFAULTS.style,
  };
}

export function formatCopyForDisplay(copy) {
  if (!copy) return "";
  const parts = [];
  if (copy.title) parts.push(`**${copy.title}**`);
  if (copy.hook) parts.push(`Hook: ${copy.hook}`);
  if (copy.voiceover) parts.push(`\n${copy.voiceover}`);
  if (copy.cta) parts.push(`\nCTA: ${copy.cta}`);
  if (copy.targetDurationSeconds) {
    parts.push(`\n~${copy.targetDurationSeconds}s estimados`);
  }
  return parts.join("\n");
}

export function parseCopyFromReview(text) {
  const voiceover = text.trim();
  return { voiceover };
}
