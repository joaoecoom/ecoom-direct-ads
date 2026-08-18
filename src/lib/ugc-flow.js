/**
 * Opções partilhadas para flow UGC + crossfade entre clips.
 */

export function resolveStoryboardStyle(storyboard, settings = {}) {
  return (
    storyboard?.style ||
    storyboard?.config?.style ||
    settings?.style ||
    "ugc"
  );
}

export function isUgcStoryboard(storyboard, settings = {}) {
  return resolveStoryboardStyle(storyboard, settings) === "ugc";
}

export function resolveCrossfadeSeconds(storyboard, settings = {}, clipCount, options = {}) {
  if (!clipCount || clipCount <= 1) return 0;

  const envRaw = process.env.VIDEO_CROSSFADE_SECONDS || "0.6";
  const env = Number.parseFloat(envRaw);
  const base = Number.isFinite(env) && env > 0 ? env : 0.6;

  if (!isUgcStoryboard(storyboard, settings)) {
    return Math.min(base, 0.45);
  }

  // Veo flow (lastFrame): clips já morfam para a cena seguinte — blend mais curto evita "double exposure"
  if (options.veoFlow) {
    return Math.max(0.28, Math.min(base, 0.42));
  }

  return base;
}

export function shouldUseUgcFlow(storyboard, settings = {}, sceneTotal) {
  return isUgcStoryboard(storyboard, settings) && sceneTotal > 1;
}

export function resolveVoicePipeline(adConfig, storyboard, settings = {}) {
  const isUgc = isUgcStoryboard(storyboard, settings);
  const ttsEngine = process.env.TTS_ENGINE || "auto";
  const veoAudioEnabled = process.env.VEO_GENERATE_AUDIO !== "false";
  const useVeoNativeAudio =
    isUgc &&
    veoAudioEnabled &&
    (adConfig.languageVariant !== "pt-PT" || ttsEngine === "veo");
  const useExternalTts =
    isUgc && adConfig.languageVariant === "pt-PT" && !useVeoNativeAudio;

  return { isUgc, useVeoNativeAudio, useExternalTts };
}
