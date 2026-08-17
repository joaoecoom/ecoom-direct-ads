import fs from "node:fs/promises";
import path from "node:path";
import textToSpeech from "@google-cloud/text-to-speech";

const DEFAULT_VOICE = process.env.GOOGLE_TTS_VOICE || "pt-PT-Wavenet-B";

/**
 * TTS português europeu via Google Cloud (mesma conta GCP / trial $300).
 */
export async function generateSpeech({
  text,
  outputPath,
  voiceName = DEFAULT_VOICE,
  languageCode = "pt-PT",
}) {
  const absPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });

  console.log(`🎙️  Google Cloud TTS (${languageCode})...`);
  console.log(`   Voz: ${voiceName}`);
  console.log(`   Texto: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}\n`);

  const client = new textToSpeech.TextToSpeechClient();
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: { languageCode, name: voiceName },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: 0.95,
      pitch: 0,
    },
  });

  if (!response.audioContent) {
    throw new Error("Google TTS não devolveu áudio.");
  }

  await fs.writeFile(absPath, response.audioContent, "binary");
  console.log(`✅ Áudio: ${absPath}\n`);
  return absPath;
}

export async function generateSceneVoiceovers(scenes, outputDir, languageCode = "pt-PT") {
  await fs.mkdir(outputDir, { recursive: true });
  const paths = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const id = scene.id || `parte-${i + 1}`;
    const text = scene.voiceoverLine?.trim();
    if (!text) continue;

    const audioPath = path.join(outputDir, `${id}.mp3`);
    await generateSpeech({ text, outputPath: audioPath, languageCode });
    paths.push({ id, audioPath, text });
  }

  return paths;
}
