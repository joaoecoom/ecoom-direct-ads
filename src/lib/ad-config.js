/**
 * Opções de anúncio — espelham os cards da plataforma (fase UI).
 * CLI e .env usam os mesmos IDs.
 */

export const AD_LANGUAGES = [
  { id: "pt", label: "Português" },
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
  { id: "fr", label: "Français" },
];

export const AD_ASPECT_RATIOS = [
  { id: "9:16", label: "Stories / Reels / TikTok", platforms: ["instagram", "tiktok"] },
  { id: "16:9", label: "YouTube / Landscape", platforms: ["youtube"] },
];

export const AD_CLIP_DURATIONS = [4, 6, 8, 10];

/** Duração total máxima (custom UI) — 10 min */
export const MAX_TOTAL_DURATION_SECONDS = Number.parseInt(
  process.env.AD_MAX_TOTAL_SECONDS || "600",
  10,
);

export const MIN_SCENE_COUNT = 1;

/** Máx. cenas = duração total / clip mais curto (ex.: 600s ÷ 4s = 150) */
export const MAX_SCENE_COUNT = Number.parseInt(
  process.env.AD_MAX_SCENE_COUNT ||
    String(Math.ceil(MAX_TOTAL_DURATION_SECONDS / Math.min(...AD_CLIP_DURATIONS))),
  10,
);

/** @deprecated use sceneCountRange — mantido para compat */
export const AD_SCENE_COUNTS = Array.from(
  { length: Math.min(MAX_SCENE_COUNT, 30) },
  (_, i) => i + 1,
);

export const AD_RESOLUTIONS = [
  { id: "720p", label: "720p (rápido)" },
  { id: "1080p", label: "1080p (premium)" },
];

export function clampSceneCount(n, max = MAX_SCENE_COUNT) {
  const value = Number.parseInt(String(n), 10);
  if (Number.isNaN(value)) return MIN_SCENE_COUNT;
  return Math.max(MIN_SCENE_COUNT, Math.min(max, value));
}

export function sceneCountFromDuration(totalSeconds, clipDurationSeconds, max = MAX_SCENE_COUNT) {
  const clip = normalizeClipDuration(clipDurationSeconds);
  const total = Number.parseInt(String(totalSeconds), 10) || clip;
  return clampSceneCount(Math.ceil(total / clip), max);
}

export const AD_TONES = [
  { id: "urgente", label: "Urgente / directo" },
  { id: "premium", label: "Premium / aspiracional" },
  { id: "amigavel", label: "Amigável / conversacional" },
  { id: "profissional", label: "Profissional / B2B" },
];

export const AD_STYLES = [
  { id: "ad", label: "Anúncio performance (AIDA)" },
  { id: "ugc", label: "UGC talking head (mesma pessoa, fala à câmara)" },
];

export const LANGUAGE_VARIANTS = {
  pt: ["pt-BR", "pt-PT"],
  en: ["en", "en-US", "en-GB"],
  es: ["es", "es-ES", "es-MX"],
  fr: ["fr", "fr-FR"],
};

export const DEFAULT_AD_CONFIG = {
  language: "pt",
  languageVariant: "pt-BR",
  aspectRatio: "9:16",
  clipDurationSeconds: 8,
  sceneCount: 3,
  resolution: "1080p",
  tone: "amigavel",
  style: "ad",
};

const LANGUAGE_LABELS = Object.fromEntries(
  AD_LANGUAGES.map((l) => [l.id, l.label]),
);

function resolveLanguageVariant(overrides = {}) {
  if (overrides.languageVariant) return overrides.languageVariant;
  if (process.env.AD_LANGUAGE_VARIANT) return process.env.AD_LANGUAGE_VARIANT;

  const language =
    overrides.language || process.env.AD_LANGUAGE || DEFAULT_AD_CONFIG.language;

  if (language === "en") return "en";
  if (language === "es") return "es";
  if (language === "fr") return "fr";
  return DEFAULT_AD_CONFIG.languageVariant;
}

export function normalizeClipDuration(seconds, fallback = DEFAULT_AD_CONFIG.clipDurationSeconds) {
  const value = Number.parseInt(String(seconds), 10);
  if (AD_CLIP_DURATIONS.includes(value)) return value;
  return fallback;
}

export function resolveAdConfig(overrides = {}) {
  const envDuration = process.env.VEO_CLIP_DURATION
    ? Number.parseInt(process.env.VEO_CLIP_DURATION, 10)
    : undefined;

  const config = {
    language:
      overrides.language ||
      process.env.AD_LANGUAGE ||
      DEFAULT_AD_CONFIG.language,
    aspectRatio:
      overrides.aspectRatio ||
      process.env.AD_ASPECT_RATIO ||
      DEFAULT_AD_CONFIG.aspectRatio,
    clipDurationSeconds: normalizeClipDuration(
      overrides.clipDurationSeconds ?? envDuration ?? DEFAULT_AD_CONFIG.clipDurationSeconds,
    ),
    sceneCount: Number.parseInt(
      String(overrides.sceneCount ?? DEFAULT_AD_CONFIG.sceneCount),
      10,
    ),
    resolution:
      overrides.resolution ||
      process.env.AD_RESOLUTION ||
      DEFAULT_AD_CONFIG.resolution,
    tone: overrides.tone || process.env.AD_TONE || DEFAULT_AD_CONFIG.tone,
    style: overrides.style || process.env.AD_STYLE || DEFAULT_AD_CONFIG.style,
    languageVariant: resolveLanguageVariant(overrides),
  };

  if (!AD_STYLES.some((s) => s.id === config.style)) {
    throw new Error(
      `Estilo inválido: ${config.style}. Opções: ${AD_STYLES.map((s) => s.id).join(", ")}`,
    );
  }

  if (!AD_LANGUAGES.some((l) => l.id === config.language)) {
    throw new Error(
      `Idioma inválido: ${config.language}. Opções: ${AD_LANGUAGES.map((l) => l.id).join(", ")}`,
    );
  }

  if (!AD_ASPECT_RATIOS.some((a) => a.id === config.aspectRatio)) {
    throw new Error(
      `Formato inválido: ${config.aspectRatio}. Opções: ${AD_ASPECT_RATIOS.map((a) => a.id).join(", ")}`,
    );
  }

  if (!AD_RESOLUTIONS.some((r) => r.id === config.resolution)) {
    throw new Error(
      `Resolução inválida: ${config.resolution}. Opções: ${AD_RESOLUTIONS.map((r) => r.id).join(", ")}`,
    );
  }

  if (config.sceneCount < MIN_SCENE_COUNT || config.sceneCount > MAX_SCENE_COUNT) {
    throw new Error(
      `Número de cenas inválido: ${config.sceneCount}. Use ${MIN_SCENE_COUNT}–${MAX_SCENE_COUNT}.`,
    );
  }

  config.totalDurationSeconds = config.sceneCount * config.clipDurationSeconds;
  config.languageLabel = LANGUAGE_LABELS[config.language] || config.language;

  return config;
}

export function formatAdConfigSummary(config) {
  const variant =
    config.languageVariant && config.languageVariant !== config.language
      ? ` (${config.languageVariant})`
      : "";
  return [
    `Idioma: ${config.languageLabel}${variant}`,
    `Formato: ${config.aspectRatio}`,
    `Duração/clip: ${config.clipDurationSeconds}s`,
    `Cenas: ${config.sceneCount} (total ~${config.totalDurationSeconds}s)`,
    `Resolução: ${config.resolution}`,
    `Tom: ${config.tone}`,
    `Estilo: ${config.style}`,
  ].join(" · ");
}

/** Parse flags CLI → overrides parciais para resolveAdConfig */
export function parseAdCliArgs(argv) {
  const overrides = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--scenes" && argv[i + 1]) {
      overrides.sceneCount = Number.parseInt(argv[++i], 10);
    } else if (
      (arg === "--duration" || arg === "--clip-duration") &&
      argv[i + 1]
    ) {
      overrides.clipDurationSeconds = Number.parseInt(argv[++i], 10);
    } else if (
      (arg === "--lang" || arg === "--language") &&
      argv[i + 1]
    ) {
      overrides.language = argv[++i];
    } else if (
      (arg === "--variant" || arg === "--language-variant") &&
      argv[i + 1]
    ) {
      overrides.languageVariant = argv[++i];
    } else if (
      (arg === "--format" || arg === "--aspect" || arg === "--aspect-ratio") &&
      argv[i + 1]
    ) {
      overrides.aspectRatio = argv[++i];
    } else if (arg === "--resolution" && argv[i + 1]) {
      overrides.resolution = argv[++i];
    } else if (arg === "--tone" && argv[i + 1]) {
      overrides.tone = argv[++i];
    } else if (arg === "--style" && argv[i + 1]) {
      overrides.style = argv[++i];
    } else if (arg === "--storyboard-only") {
      overrides.storyboardOnly = true;
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  return { overrides, offer: positional.join(" ").trim() };
}
