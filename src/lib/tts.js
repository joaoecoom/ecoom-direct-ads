import { generateSceneVoiceovers as elevenLabsVoiceovers } from "./elevenlabs.js";
import { generateSceneVoiceovers as googleVoiceovers } from "./google-tts.js";

/**
 * Voz PT-PT: ElevenLabs (voz europeia) se tiver chave, senão Google Cloud TTS pt-PT.
 */
export async function generateSceneVoiceovers(scenes, outputDir, { languageVariant = "pt-PT" } = {}) {
  const engine = process.env.TTS_ENGINE || "auto";
  const hasElevenLabs = Boolean(process.env.ELEVENLABS_API_KEY);

  if (
    hasElevenLabs &&
    (engine === "elevenlabs" || (engine === "auto" && languageVariant === "pt-PT"))
  ) {
    console.log("   Motor TTS: ElevenLabs (voz PT europeu)\n");
    return elevenLabsVoiceovers(scenes, outputDir, languageVariant);
  }

  if (engine === "google" || engine === "auto") {
    console.log("   Motor TTS: Google Cloud (pt-PT europeu)\n");
    return googleVoiceovers(scenes, outputDir, languageVariant);
  }

  throw new Error(
    "Nenhum motor TTS disponível. Define ELEVENLABS_API_KEY ou TTS_ENGINE=google.",
  );
}
