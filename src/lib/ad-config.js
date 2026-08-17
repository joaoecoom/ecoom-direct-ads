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

export const AD_RESOLUTIONS = [
  { id: "720p", label: "720p (rápido)" },
  { id: "1080p", label: "1080p (premium)" },
];

export const AD_SCENE_COUNTS = [1, 2, 3, 4, 5];

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

  if (!AD_SCENE_COUNTS.includes(config.sceneCount)) {
    throw new Error(
      `Número de cenas inválido: ${config.sceneCount}. Opções: ${AD_SCENE_COUNTS.join(", ")}`,
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
