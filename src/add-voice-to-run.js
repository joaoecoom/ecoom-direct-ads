/**
 * Adiciona voz PT-PT (ElevenLabs) a um run existente — sem regenerar imagens/Veo.
 *
 * Uso:
 *   node src/add-voice-to-run.js 2026-08-17T19-00-51-333Z
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, ensureOutputDir } from "./config.js";
import { concatenateVideos } from "./lib/concat-videos.js";
import { generateSceneVoiceovers } from "./lib/tts.js";
import { mixSceneClipsWithVoice } from "./lib/mix-audio.js";
import { isLipSyncAvailable, lipSyncSceneClips } from "./lib/lipsync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error("Uso: node src/add-voice-to-run.js <run-id>");
    console.error("Ex:  node src/add-voice-to-run.js 2026-08-17T19-00-51-333Z");
    process.exit(1);
  }

  const config = loadConfig();
  const storyboardPath = path.join(ROOT, "prompts", `storyboard-${runId}.json`);
  const storyboard = JSON.parse(await fs.readFile(storyboardPath, "utf8"));

  const sceneIds = storyboard.scenes.map((s) => s.id);
  const videoClips = sceneIds.map((id) =>
    path.join(config.outputDir, "scenes", `${id}.mp4`),
  );

  for (const clip of videoClips) {
    await fs.access(clip);
  }

  console.log(`\n🎙️  A gerar voz PT-PT para run ${runId}...\n`);

  const audioDir = path.join(config.outputDir, `audio-${runId}`);
  const voiceParts = await generateSceneVoiceovers(storyboard.scenes, audioDir, {
    languageVariant: storyboard.languageVariant || "pt-PT",
  });

  const sceneClips = storyboard.scenes.map((scene, idx) => ({
    id: scene.id,
    videoPath: videoClips[idx],
    audioPath: voiceParts.find((v) => v.id === scene.id)?.audioPath,
  }));

  let finalClips;
  if (isLipSyncAvailable()) {
    console.log("\n👄 Lip sync real (Sync Labs)...\n");
    const syncedDir = path.join(config.outputDir, `synced-${runId}`);
    finalClips = await lipSyncSceneClips(sceneClips, syncedDir);
  } else {
    console.log("\n⚠️  SEM LIP SYNC — SYNC_LABS_API_KEY em falta\n");
    const voicedDir = path.join(config.outputDir, `voiced-${runId}`);
    finalClips = await mixSceneClipsWithVoice(sceneClips, voicedDir);
  }

  const slug = (storyboard.title || "ugc")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);

  await ensureOutputDir(config.outputDir);
  const finalVideo = path.join(config.outputDir, `${slug}-${runId}.mp4`);

  console.log("🔗 A juntar clips com voz...");
  await concatenateVideos(finalClips, finalVideo);

  console.log(`\n✅ Vídeo com voz PT-PT: ${finalVideo}\n`);
}

main().catch((err) => {
  console.error("\n❌ Erro:", err.message);
  process.exit(1);
});
