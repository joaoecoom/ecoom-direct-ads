/**
 * Constrói o brief estruturado a partir das respostas do wizard.
 */

const CREATIVE_LABELS = {
  ugcSetting: {
    car: "No carro (selfie condutor/passageiro)",
    home: "Em casa (cozinha, sala, quarto)",
    office: "Consultório / escritório",
    podcast: "Setup podcast (microfone, mesa)",
    street: "Na rua / caminhada",
    gym: "Ginásio / fitness",
    store: "Loja / retail",
    interview: "Entrevista (duas pessoas)",
    bathroom: "Casa de banho / espelho (GRWM)",
    custom: "Outro (descrever)",
  },
  videoFormat: {
    talking_head: "100% UGC — só pessoa a falar",
    ugc_broll: "UGC + B-roll entrecortado",
    ugc_react: "UGC react — reage ao ecrã",
    ugc_demo: "UGC demo — mostra produto",
    mixed: "Mix criativo (hook + UGC + prova)",
  },
  brollSource: { ai: "B-roll IA", import: "B-roll importado", both: "Misto IA + import" },
  hookStyle: {
    mechanism: "Hook mecanismo (dor → solução)",
    pattern_interrupt: "Pattern interrupt",
    question: "Pergunta directa",
    controversy: "Hot take / controversy",
    story: "Mini-história 3s",
    stat: "Número surpreendente",
  },
  captions: {
    none: "Sem legendas",
    tiktok_bold: "TikTok bold",
    hormozi: "Estilo Hormozi",
    subtitle_clean: "Legendas limpas",
    emoji_pop: "Com emojis",
  },
  backgroundMusic: {
    none: "Sem música",
    soft_bed: "Música suave de fundo",
    trending_lofi: "Lo-fi trending",
    custom: "Música custom",
  },
  editSfx: {
    none: "Sem efeitos",
    whoosh_cuts: "Whoosh nos cortes",
    pop_zoom: "Pop + micro zoom",
    full_dr: "Pack DR completo",
  },
};

function creativeLabel(map, id) {
  return CREATIVE_LABELS[map]?.[id] || id;
}

function buildCreativeBriefSection(w) {
  const lines = [
    "## Direcção criativa (vídeo)",
    `- Cenário UGC: ${creativeLabel("ugcSetting", w.ugcSetting)}`,
    `- Formato: ${creativeLabel("videoFormat", w.videoFormat)}`,
  ];
  if (w.videoFormat !== "talking_head") {
    lines.push(
      `- B-roll: ${creativeLabel("brollSource", w.brollSource)} · intensidade ${w.brollRatio || "medium"}`,
    );
  }
  if (w.videoFormat === "ugc_react") {
    lines.push("- UGC react: pessoa reage a conteúdo no ecrã do anúncio.");
  }
  lines.push(
    `- Hook (3s): ${creativeLabel("hookStyle", w.hookStyle)}`,
    `- Legendas: ${creativeLabel("captions", w.captions)}`,
    `- Música: ${creativeLabel("backgroundMusic", w.backgroundMusic)}`,
    `- Efeitos nos cortes: ${creativeLabel("editSfx", w.editSfx)}`,
  );
  return lines.join("\n");
}

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
  ugcSetting: "home",
  videoFormat: "talking_head",
  brollSource: "ai",
  brollRatio: "medium",
  hookStyle: "mechanism",
  captions: "tiktok_bold",
  backgroundMusic: "soft_bed",
  editSfx: "whoosh_cuts",
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
    buildCreativeBriefSection(w),
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
    ugcSetting: w.ugcSetting,
    videoFormat: w.videoFormat,
    brollSource: w.brollSource,
    brollRatio: w.brollRatio,
    hookStyle: w.hookStyle,
    captions: w.captions,
    backgroundMusic: w.backgroundMusic,
    editSfx: w.editSfx,
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
    ugcSetting: settings.ugcSetting || WIZARD_DEFAULTS.ugcSetting,
    videoFormat: settings.videoFormat || WIZARD_DEFAULTS.videoFormat,
    brollSource: settings.brollSource || WIZARD_DEFAULTS.brollSource,
    brollRatio: settings.brollRatio || WIZARD_DEFAULTS.brollRatio,
    hookStyle: settings.hookStyle || WIZARD_DEFAULTS.hookStyle,
    captions: settings.captions || WIZARD_DEFAULTS.captions,
    backgroundMusic: settings.backgroundMusic || WIZARD_DEFAULTS.backgroundMusic,
    editSfx: settings.editSfx || WIZARD_DEFAULTS.editSfx,
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
