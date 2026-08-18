/**
 * Opções criativas Direct Response — UGC, B-roll, hooks, pós-produção.
 * Usadas no wizard, brief, storyboard e (futuro) export FFmpeg.
 */

export const AD_UGC_SETTINGS = [
  { id: "car", label: "No carro (selfie condutor/passageiro)" },
  { id: "home", label: "Em casa (cozinha, sala, quarto)" },
  { id: "office", label: "Consultório / escritório" },
  { id: "podcast", label: "Setup podcast (microfone, mesa)" },
  { id: "street", label: "Na rua / caminhada" },
  { id: "gym", label: "Ginásio / fitness" },
  { id: "store", label: "Loja / retail" },
  { id: "interview", label: "Entrevista (duas pessoas, over-shoulder)" },
  { id: "bathroom", label: "Casa de banho / espelho (GRWM)" },
  { id: "custom", label: "Outro (descrever no brief)" },
];

export const AD_VIDEO_FORMATS = [
  { id: "talking_head", label: "100% UGC — só pessoa a falar à câmara" },
  { id: "ugc_broll", label: "UGC + B-roll entrecortado (produto, lifestyle, detalhes)" },
  { id: "ugc_react", label: "UGC react — reage a algo no ecrã do anúncio" },
  { id: "ugc_demo", label: "UGC demo — mostra produto enquanto fala" },
  { id: "mixed", label: "Mix criativo — hook visual + UGC + prova social" },
];

export const AD_BROLL_SOURCES = [
  { id: "ai", label: "B-roll gerado por IA (Nano Banana + Veo)" },
  { id: "import", label: "B-roll importado (assets do projecto)" },
  { id: "both", label: "Misto — IA + assets importados" },
];

export const AD_HOOK_STYLES = [
  { id: "mechanism", label: "Hook mecanismo — liga à dor/solução do produto" },
  { id: "pattern_interrupt", label: "Pattern interrupt — frase/visual chocante" },
  { id: "question", label: "Pergunta directa ao público" },
  { id: "controversy", label: "Controversy / hot take (direct response)" },
  { id: "story", label: "Mini-história nos primeiros 3s" },
  { id: "stat", label: "Número ou facto surpreendente" },
];

export const AD_CAPTION_STYLES = [
  { id: "none", label: "Sem legendas" },
  { id: "tiktok_bold", label: "TikTok bold — palavra a palavra, centro" },
  { id: "hormozi", label: "Estilo Hormozi — palavras-chave destacadas" },
  { id: "subtitle_clean", label: "Legendas limpas — fundo semi-transparente" },
  { id: "emoji_pop", label: "Com emojis nos beats principais" },
];

export const AD_POST_AUDIO = [
  { id: "none", label: "Sem música de fundo" },
  { id: "soft_bed", label: "Música suave de fundo (baixo volume)" },
  { id: "trending_lofi", label: "Lo-fi / trending bed (direct response)" },
  { id: "custom", label: "Música custom (importar depois)" },
];

export const AD_EDIT_SFX = [
  { id: "none", label: "Sem efeitos de edição" },
  { id: "whoosh_cuts", label: "Whoosh nos cortes entre takes" },
  { id: "pop_zoom", label: "Pop + micro zoom nos cortes" },
  { id: "full_dr", label: "Pack DR — whoosh, pop, risers nos hooks" },
];

export const DEFAULT_CREATIVE_FORMAT = {
  ugcSetting: "home",
  videoFormat: "talking_head",
  brollSource: "ai",
  brollRatio: "medium",
  hookStyle: "mechanism",
  captions: "tiktok_bold",
  backgroundMusic: "soft_bed",
  editSfx: "whoosh_cuts",
};

const LABEL_MAPS = {
  ugcSetting: AD_UGC_SETTINGS,
  videoFormat: AD_VIDEO_FORMATS,
  brollSource: AD_BROLL_SOURCES,
  hookStyle: AD_HOOK_STYLES,
  captions: AD_CAPTION_STYLES,
  backgroundMusic: AD_POST_AUDIO,
  editSfx: AD_EDIT_SFX,
};

export function resolveCreativeFormat(overrides = {}) {
  const base = { ...DEFAULT_CREATIVE_FORMAT, ...overrides };
  for (const [key, options] of Object.entries(LABEL_MAPS)) {
    if (!options.some((o) => o.id === base[key])) {
      base[key] = DEFAULT_CREATIVE_FORMAT[key];
    }
  }
  if (!["low", "medium", "high"].includes(base.brollRatio)) {
    base.brollRatio = DEFAULT_CREATIVE_FORMAT.brollRatio;
  }
  return base;
}

export function labelForCreativeField(field, id) {
  const list = LABEL_MAPS[field];
  return list?.find((o) => o.id === id)?.label || id;
}

/** Bloco para brief master prompt e storyboard system prompt */
export function buildCreativeDirectionBlock(creative) {
  const c = resolveCreativeFormat(creative);
  const lines = [
    "## Direcção criativa (vídeo)",
    `- Cenário UGC: ${labelForCreativeField("ugcSetting", c.ugcSetting)}`,
    `- Formato: ${labelForCreativeField("videoFormat", c.videoFormat)}`,
  ];

  if (c.videoFormat !== "talking_head") {
    lines.push(`- B-roll: ${labelForCreativeField("brollSource", c.brollSource)} · intensidade ${c.brollRatio}`);
  }
  if (c.videoFormat === "ugc_react") {
    lines.push(
      "- UGC REACT: a pessoa reage a conteúdo no ecrã (screenshot, vídeo, review, preço). Mostrar reacção facial + comentário.",
    );
  }

  lines.push(
    `- Hook (primeiros 3s): ${labelForCreativeField("hookStyle", c.hookStyle)} — DEVE ligar ao mecanismo/produto`,
    `- Legendas: ${labelForCreativeField("captions", c.captions)}`,
    `- Música final: ${labelForCreativeField("backgroundMusic", c.backgroundMusic)}`,
    `- Efeitos nos cortes: ${labelForCreativeField("editSfx", c.editSfx)}`,
  );

  return lines.join("\n");
}

/** Regras extra para Gemini storyboard */
export function getStoryboardCreativeRules(creative) {
  const c = resolveCreativeFormat(creative);
  const rules = [];

  rules.push(`
CENÁRIO UGC FIXO: ${labelForCreativeField("ugcSetting", c.ugcSetting)} — characterBrief + settingBrief devem reflectir isto.`);

  if (c.hookStyle === "mechanism") {
    rules.push(`
HOOK (cena 1): primeiros 3 segundos DEVEM captar atenção com o MECANISMO do produto (dor → solução). voiceoverLine curta e directa.`);
  } else {
    rules.push(`
HOOK (cena 1): estilo ${labelForCreativeField("hookStyle", c.hookStyle)} — máximo impacto nos primeiros 3s, ligado ao produto.`);
  }

  if (c.videoFormat === "talking_head") {
    rules.push(`
FORMATO 100% UGC: todas as cenas são talking head — mesma pessoa, mesma roupa, mesmo cenário, só muda expressão/gesto.`);
  } else if (c.videoFormat === "ugc_broll" || c.videoFormat === "mixed") {
    const ratio =
      c.brollRatio === "high" ? "~40% B-roll" : c.brollRatio === "low" ? "~15% B-roll" : "~25% B-roll";
    rules.push(`
FORMATO UGC + B-ROLL (${ratio}): alternar cenas UGC (sceneType: "ugc") com B-roll (sceneType: "broll").
- B-roll: produto, mãos, lifestyle, close-ups — SEM a cara a falar (ou só mãos/pés).
- B-roll source: ${c.brollSource === "import" ? "descrever para import manual" : "gerar por IA, coerente com o ad"}.
- Manter identidade UGC nas cenas ugc; B-roll partilha paleta de cores.`);
  } else if (c.videoFormat === "ugc_react") {
    rules.push(`
FORMATO UGC REACT: cenas alternadas ugc + react_overlay.
- react_overlay: pessoa reage a elemento no ecrã (review, preço, antes/depois, vídeo dentro do vídeo).
- imagePrompt react: mostrar pessoa + overlay de conteúdo no telemóvel/ecrã.`);
  } else if (c.videoFormat === "ugc_demo") {
    rules.push(`
FORMATO UGC DEMO: pessoa fala ENQUANTO mostra produto — mãos, embalagem, uso. Mesma identidade.`);
  }

  if (c.editSfx !== "none") {
    rules.push(`
EDIÇÃO: entre takes UGC, planear cortes com ${labelForCreativeField("editSfx", c.editSfx)} (nota em editingNotes por cena).`);
  }

  if (c.captions !== "none") {
    rules.push(`
LEGENDAS: onScreenText em PT-PT estilo ${labelForCreativeField("captions", c.captions)} — palavras-chave do hook e CTA.`);
  }

  return rules.join("\n");
}
