import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureOutputDir, loadConfig, sleep, timestampSlug } from "./config.js";
import { formatAdConfigSummary, resolveAdConfig } from "./lib/ad-config.js";
import { generateSceneVoiceovers } from "./lib/tts.js";
import { generateImage, generateImageVariation } from "./lib/imagen.js";
import {
  buildFlowMotionPrompt,
  buildVeoMotionPromptWithDialogue,
  stripDialogueFromMotionPrompt,
} from "./lib/image-prompts.js";
import { concatenateVideos } from "./lib/concat-videos.js";
import { mixSceneClipsWithVoice } from "./lib/mix-audio.js";
import { isLipSyncAvailable, lipSyncSceneClips } from "./lib/lipsync.js";
import { generateStoryboard } from "./lib/storyboard.js";
import { runSequence } from "./generate-sequence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * @param {{ offer: string, overrides?: object, runId?: string, storyboardOnly?: boolean, onProgress?: (update: object) => void }} params
 */
export async function runAdGeneration({
  offer,
  overrides = {},
  runId = timestampSlug(),
  storyboardOnly = false,
  onProgress,
}) {
  const progress = (step, message, extra = {}) => {
    onProgress?.({ step, message, runId, ...extra });
  };

  if (!offer?.trim()) {
    throw new Error("Brief da oferta em falta.");
  }

  const adConfig = resolveAdConfig(overrides);
  const config = loadConfig();
  await ensureOutputDir(config.outputDir);

  progress("config", formatAdConfigSummary(adConfig), { adConfig, offer });

  progress("storyboard", "A gerar storyboard com Gemini...");
  const storyboard = await generateStoryboard({ offer, adConfig });

  const storyboardPath = path.join(PROJECT_ROOT, "prompts", `storyboard-${runId}.json`);
  await fs.mkdir(path.dirname(storyboardPath), { recursive: true });
  await fs.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2));

  if (storyboardOnly) {
    return {
      runId,
      storyboardPath,
      storyboard,
      adConfig,
    };
  }

  const assetsRunDir = path.join(PROJECT_ROOT, "assets", `run-${runId}`);
  await fs.mkdir(assetsRunDir, { recursive: true });

  const clipDuration = storyboard.durationSeconds;
  const aspectRatio = storyboard.aspectRatio || adConfig.aspectRatio;
  const resolution = storyboard.resolution || adConfig.resolution;
  const isUgc = storyboard.style === "ugc";
  const sceneTotal = storyboard.scenes.length;

  const sequenceScenes = [];
  let previousImagePath = null;

  const ttsEngine = process.env.TTS_ENGINE || "auto";
  const veoAudioEnabled = process.env.VEO_GENERATE_AUDIO !== "false";
  const useVeoNativeAudio =
    isUgc &&
    veoAudioEnabled &&
    (adConfig.languageVariant !== "pt-PT" || ttsEngine === "veo");
  const useExternalTts =
    isUgc &&
    adConfig.languageVariant === "pt-PT" &&
    !useVeoNativeAudio;

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const id = scene.id || `parte-${i + 1}`;
    const imageFile = path.join(assetsRunDir, `${id}.png`);

    progress("image", `Imagem ${i + 1}/${sceneTotal}: ${id}`, {
      sceneIndex: i + 1,
      sceneTotal,
      sceneId: id,
    });

    if (isUgc && i === 0) {
      await generateImage({
        prompt: scene.imagePrompt,
        outputPath: imageFile,
        aspectRatio,
        ugc: true,
      });
    } else if (isUgc && previousImagePath) {
      await sleep(4000);
      await generateImageVariation({
        prompt: scene.visualBeat || scene.imagePrompt,
        referenceImagePath: previousImagePath,
        outputPath: imageFile,
        aspectRatio,
        sceneIndex: i + 1,
        sceneTotal,
      });
    } else {
      await generateImage({
        prompt: scene.imagePrompt,
        outputPath: imageFile,
        aspectRatio,
        ugc: isUgc,
      });
    }

    previousImagePath = imageFile;

    const motionBase = stripDialogueFromMotionPrompt(
      scene.motionPrompt ||
        buildFlowMotionPrompt(clipDuration, scene.visualBeat),
    );

    const veoPrompt = useVeoNativeAudio
      ? buildVeoMotionPromptWithDialogue({
          motionBase,
          voiceoverLine: scene.voiceoverLine,
          languageVariant: adConfig.languageVariant,
          clipDurationSeconds: clipDuration,
        })
      : `${motionBase} Person speaking naturally to camera, visible mouth movement mid-speech, subtle lip motion, preserve identity.`;

    sequenceScenes.push({
      id,
      image: imageFile,
      prompt: veoPrompt,
      visualBeat: scene.visualBeat,
      voiceoverLine: scene.voiceoverLine,
      aspectRatio,
      durationSeconds: clipDuration,
      resolution,
    });

    if (i < sceneTotal - 1) await sleep(3000);
  }

  const slug = (storyboard.title || "ugc")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);

  const videoSuffix = useVeoNativeAudio ? "" : "-silent";
  const silentPath = path.join(config.outputDir, `${slug}-${runId}${videoSuffix}.mp4`);

  progress("video", `A animar ${sceneTotal} cena(s) com Veo...`, { sceneTotal });

  const useFlow = isUgc && sceneTotal > 1;

  const manifest = await runSequence({
    aspectRatio,
    durationSeconds: clipDuration,
    resolution,
    flow: useFlow,
    crossfadeSeconds: useFlow ? 0.35 : 0,
    keepAudio: useVeoNativeAudio,
    outputFileName: path.basename(silentPath),
    storyboard,
    scenes: sequenceScenes,
  });

  let finalVideo = manifest.finalVideo;

  if (useExternalTts) {
    progress("voice", "A gerar voz PT-PT...");
    const audioDir = path.join(config.outputDir, `audio-${runId}`);
    const voiceParts = await generateSceneVoiceovers(storyboard.scenes, audioDir, {
      languageVariant: adConfig.languageVariant,
    });

    const sceneClips = storyboard.scenes.map((scene, idx) => ({
      id: scene.id || `parte-${idx + 1}`,
      videoPath: manifest.clips[idx],
      audioPath: voiceParts.find((v) => v.id === scene.id)?.audioPath,
    }));

    for (const s of sceneClips) {
      if (!s.audioPath) {
        throw new Error(`Áudio em falta para cena ${s.id}`);
      }
    }

    let voicedClips;
    if (isLipSyncAvailable()) {
      progress("lipsync", "Lip sync Sync Labs...");
      const syncedDir = path.join(config.outputDir, `synced-${runId}`);
      voicedClips = await lipSyncSceneClips(sceneClips, syncedDir);
    } else {
      progress("mix", "A mixar áudio (sem lip sync)...");
      const voicedDir = path.join(config.outputDir, `voiced-${runId}`);
      voicedClips = await mixSceneClipsWithVoice(sceneClips, voicedDir);
    }

    finalVideo = path.join(config.outputDir, `${slug}-${runId}.mp4`);
    await concatenateVideos(voicedClips, finalVideo, {
      crossfadeSeconds: useFlow ? 0.35 : 0,
      keepAudio: true,
    });
  }

  const copyPath = path.join(config.outputDir, `copy-${runId}.json`);
  const copy = {
    title: storyboard.title,
    voiceover: storyboard.voiceover,
    language: adConfig.languageVariant || adConfig.language,
    style: storyboard.style,
    parts: storyboard.scenes.map((s) => ({
      id: s.id,
      voiceoverLine: s.voiceoverLine,
      visualBeat: s.visualBeat,
    })),
  };

  await fs.writeFile(copyPath, JSON.stringify(copy, null, 2));

  progress("done", "Anúncio concluído.", { finalVideo, copyPath });

  return {
    runId,
    storyboardPath,
    storyboard,
    adConfig,
    finalVideo,
    copyPath,
    copy,
    manifest,
  };
}
