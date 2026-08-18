/**
 * Prompts otimizados para imagens UGC hiper-realistas (Nano Banana Pro).
 */

export const HUMAN_REALISM_SUFFIX = `
Authentic unedited smartphone selfie still, iPhone 15 Pro front camera 24mm, slight lens distortion.
Real human photographed in life — NOT AI-generated look, NOT illustration, NOT 3D, NOT CGI.
Skin: visible pores, fine lines, subtle under-eye texture, natural uneven skin tone, faint nose shine,
micro-imperfections, occasional blemish, asymmetric face (slightly), natural eyebrow thickness variation.
Eyes: realistic moisture, natural catchlight, not oversized or doll-like.
Hair: individual strands, slight flyaways, not plastic helmet hair.
Hands: anatomically correct fingers, natural knuckle wrinkles if visible.
Lighting: soft natural window light from one side, gentle falloff, realistic shadows — NOT studio flash.
Depth: shallow depth of field, slight background bokeh, minor sensor noise/grain like real phone video frame.
Expression: candid mid-conversation, not stock-photo smile, not beauty-filter polished.
Documentary realism, TikTok/Reels creator talking to camera.
NO text overlays, NO watermarks, NO logos, NO captions, NO subtitles in image.`;

export const HUMAN_REALISM_NEGATIVE = `
STRICTLY AVOID: AI face, plastic skin, wax figure, doll eyes, beauty filter, airbrushed porcelain skin,
symmetrical perfect face, uncanny valley, cartoon, anime, 3D render, illustration, stock photo glamour,
HDR overprocessed, fake tan, overly white teeth, extra fingers, fused fingers, blurred deformed hands,
oversaturated colors, cinematic teal-orange grade, model agency look, mannequin stare.`;

export function buildHumanizedImagePrompt(basePrompt, { ugc = false } = {}) {
  const core = basePrompt.trim();
  if (!ugc) {
    return `${core}. Photorealistic, premium advertising photography, natural lighting.`;
  }
  return `${core}
${HUMAN_REALISM_SUFFIX}
${HUMAN_REALISM_NEGATIVE}`;
}

export function buildHumanizedVariationPrompt(visualBeat, sceneIndex, sceneTotal) {
  return `${visualBeat}. Frame ${sceneIndex}/${sceneTotal} of ONE continuous handheld UGC selfie video — same take, same person.
SAME face identity: age, skin texture, hair, body type — preserve from reference frame exactly.
Same phone distance and angle; only natural micro-movement (expression, slight head tilt, hand gesture).
If the beat changes location, evolve the background gradually — never a jump-cut look.
Preserve all human realism from reference — do NOT reset to generic AI face.
${HUMAN_REALISM_SUFFIX}
${HUMAN_REALISM_NEGATIVE}`;
}

export function buildFlowMotionPrompt(clipDurationSeconds, beat = "", { bridging = false } = {}) {
  const beatPart = beat ? `${beat}. ` : "";
  const bridge = bridging
    ? "Continuous motion evolving smoothly toward the final frame, decelerate naturally at end, same person outfit and lighting, no jump cut, no scene reset, "
    : "Single continuous take, ";
  return `${beatPart}${bridge}subtle lip and head movement while speaking, minimal handheld phone shake, smooth natural motion, preserve exact face identity outfit and background from source image, UGC selfie, ${clipDurationSeconds} second clip`;
}

/** Remove blocos de diálogo/áudio — motionPrompt fica só visual. */
export function stripDialogueFromMotionPrompt(prompt = "") {
  let p = prompt.trim();
  const cutPatterns = [
    /They say exactly:[\s\S]*/i,
    /speaks directly to camera in European Portuguese[\s\S]*/i,
    /Spoken dialogue \(exact words[\s\S]*/i,
    /A real Portuguese person from Lisbon[\s\S]*?Visual:/i,
    /European Portuguese from Portugal[\s\S]*/i,
    /Lip sync[\s\S]*/i,
    /Audio: clear European Portuguese[\s\S]*/i,
    /NOT Brazilian Portuguese[\s\S]*/i,
  ];
  for (const re of cutPatterns) {
    p = p.replace(re, "").trim();
  }
  return p.replace(/\.\s*(\.)+/g, ".").replace(/\s+/g, " ").trim();
}

/**
 * Prompt Veo 3 — diálogo PT-PT (áudio nativo).
 * VEO_PROMPT_LOCALE=pt-PT → prompt todo em português (como no Flow Labs).
 */
export function buildVeoMotionPromptWithDialogue({
  motionBase,
  voiceoverLine,
  languageVariant = "pt-PT",
  clipDurationSeconds = 8,
}) {
  const visual = stripDialogueFromMotionPrompt(motionBase) ||
    buildFlowMotionPrompt(clipDurationSeconds);
  const line = voiceoverLine?.trim();
  if (!line) return visual;

  const usePortuguesePrompt =
    process.env.VEO_PROMPT_LOCALE === "pt-PT" ||
    process.env.VEO_PROMPT_LOCALE === "pt";

  if (languageVariant === "pt-PT" && usePortuguesePrompt) {
    return `Plano médio, a mesma pessoa da imagem fala directamente para a câmara num vídeo UGC selfie, consultório moderno em Lisboa.
ÁUDIO — português de Portugal (sotaque de Lisboa, NÃO brasileiro, NÃO inglês). Diz exactamente: "${line}"
Tom: médico amigável, conversacional, natural. Lip sync durante ${clipDurationSeconds} segundos.
Movimento visual: ${visual}
Ambiente silencioso de consultório. Sem música. Sem legendas. Sem texto no ecrã.`;
  }

  if (languageVariant === "pt-PT") {
    return `A middle-aged male doctor from Lisbon, Portugal looks directly at the camera in a UGC selfie video.
He says in a clear Lisbon European Portuguese accent (NOT Brazilian, NOT English): "${line}"
Voice: native European Portuguese from Portugal, warm conversational medical tone, natural lip sync for ${clipDurationSeconds} seconds.
Visual motion: ${visual}
Ambient: quiet modern office room tone. No music. No subtitles. No on-screen text. No captions.`;
  }

  return `${visual} The person speaks in ${languageVariant}. They say exactly: ${line}. Natural lip sync, no subtitles.`;
}
