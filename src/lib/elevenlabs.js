import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const DEFAULT_VOICE = process.env.ELEVENLABS_VOICE_ID || "onwK4e9ZLuTAKqWW03F9"; // Daniel — multilingual

/**
 * Gera áudio TTS com ElevenLabs (suporta PT-PT via eleven_multilingual_v2).
 */
export async function generateSpeech({
  text,
  outputPath,
  voiceId = DEFAULT_VOICE,
  modelId = DEFAULT_MODEL,
  languageCode = "pt",
}) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ELEVENLABS_API_KEY em falta no .env — necessário para voz PT-PT.",
    );
  }

  const absPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });

  console.log(`🎙️  ElevenLabs TTS (${languageCode})...`);
  console.log(`   Texto: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}\n`);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs erro ${response.status}: ${errText.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(absPath, buffer);
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
