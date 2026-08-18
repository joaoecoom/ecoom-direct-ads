const AD_OVERRIDE_KEYS = [
  "language",
  "languageVariant",
  "aspectRatio",
  "resolution",
  "tone",
  "style",
  "clipDurationSeconds",
  "sceneCount",
];

/** Extrai só campos válidos de ad-config — evita lixo do body no resolveAdConfig. */
export function pickAdOverrides(raw = {}) {
  const out = {};
  for (const key of AD_OVERRIDE_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") {
      out[key] = raw[key];
    }
  }
  return out;
}
