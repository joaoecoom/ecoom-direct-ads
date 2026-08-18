import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureOutputDir, loadConfig, sleep, timestampSlug } from "./config.js";
import { formatAdConfigSummary, resolveAdConfig } from "./lib/ad-config.js";
import { generateSceneVoiceovers } from "./lib/tts.js";
import { generateStoryboardImages } from "./lib/scene-images.js";
import {
  buildFlowMotionPrompt,
  buildVeoMotionPromptWithDialogue,
  stripDialogueFromMotionPrompt,
} from "./lib/image-prompts.js";
import { concatenateVideos } from "./lib/concat-videos.js";
import { mixSceneClipsWithVoice } from "./lib/mix-audio.js";
import { isLipSyncAvailable, lipSyncSceneClips } from "./lib/lipsync.js";
import { generateStoryboard, generateStoryboardFromCopy } from "./lib/storyboard.js";
import { generateAdCopy } from "./lib/copy-writer.js";
import { runSequence } from "./generate-sequence.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * @param {{ offer: string, overrides?: object, runId?: string, storyboardOnly?: boolean, copyOnly?: boolean, approvedCopy?: object, wizard?: object, onProgress?: (update: object) => void }} params
 */
export async function runAdGeneration({
  offer,
  overrides = {},
  runId = timestampSlug(),
  storyboardOnly = false,
  copyOnly = false,
  approvedCopy = null,
  wizard = null,
  onProgress,
}) {
  const progress = async (step, message, extra = {}) => {
    if (onProgress) await onProgress({ step, message, runId, ...extra });
  };

  if (!offer?.trim()) {
    throw new Error("Brief da oferta em falta.");
  }

  const adConfig = resolveAdConfig(overrides);
  const config = loadConfig();
  await ensureOutputDir(config.outputDir);

  await progress("config", formatAdConfigSummary(adConfig), { adConfig, offer });

  if (copyOnly) {
    await progress("copy", "A escrever copy — hook, argumento e CTA...");
    const copy = await generateAdCopy({
      offer,
      overrides: adConfig,
      wizard: wizard || overrides.wizard || {},
    });
    const copyPath = path.join(config.outputDir, `copy-${runId}.json`);
    await fs.writeFile(copyPath, JSON.stringify(copy, null, 2));
    await progress("done", "Copy pronta para revisão.");
    return { runId, copy, copyPath, adConfig };
  }

  let copy = approvedCopy;
  if (!copy && overrides.useCopyFirst !== false) {
    await progress("copy", "A escrever copy — hook, argumento e CTA...");
    copy = await generateAdCopy({
      offer,
      overrides: adConfig,
      wizard: wizard || overrides.wizard || {},
    });
  }

  let storyboard;
  if (copy) {
    await progress(
      "storyboard",
      `A planear ${copy.targetDurationSeconds ? `~${copy.targetDurationSeconds}s · ` : ""}cenas a partir da copy...`,
    );
    storyboard = await generateStoryboardFromCopy({
      offer,
      copy,
      adConfig: adConfig,
    });
  } else {
    await progress("storyboard", "A gerar storyboard com Gemini...");
    storyboard = await generateStoryboard({ offer, adConfig });
  }

  const storyboardPath = path.join(PROJECT_ROOT, "prompts", `storyboard-${runId}.json`);
  await fs.mkdir(path.dirname(storyboardPath), { recursive: true });
  await fs.writeFile(storyboardPath, JSON.stringify(storyboard, null, 2));

  if (storyboardOnly) {
    const copyPath = copy
      ? path.join(config.outputDir, `copy-${runId}.json`)
      : null;
    if (copy && copyPath) {
      await fs.writeFile(copyPath, JSON.stringify(copy, null, 2));
    }
    return {
      runId,
      storyboardPath,
      storyboard,
      adConfig,
      copy,
      copyPath,
    };
  }

  const assetsRunDir = path.join(PROJECT_ROOT, "assets", `run-${runId}`);
  await fs.mkdir(assetsRunDir, { recursive: true });

  const clipDuration = storyboard.durationSeconds;
  const aspectRatio = storyboard.aspectRatio || adConfig.aspectRatio;
  const resolution = storyboard.resolution || adConfig.resolution;
  const isUgc = storyboard.style === "ugc";
  const sceneTotal = storyboard.scenes.length;

  const { images: generatedImages } = await generateStoryboardImages({
    storyboard,
    adConfig,
    outputDir: assetsRunDir,
    onProgress: async (update) => {
      await progress("image", update.message, {
        sceneIndex: update.sceneIndex,
        sceneTotal: update.sceneTotal,
        sceneId: update.sceneId,
      });
    },
  });

  const sequenceScenes = [];

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
    const imageFile = generatedImages[i]?.path || path.join(assetsRunDir, `${id}.png`);

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
  }

  const slug = (storyboard.title || "ugc")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);

  const videoSuffix = useVeoNativeAudio ? "" : "-silent";
  const silentPath = path.join(config.outputDir, `${slug}-${runId}${videoSuffix}.mp4`);

  await progress("video", `A animar ${sceneTotal} cena(s) com Veo...`, { sceneTotal });

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
    onProgress: async (update) =>
      progress("video", update.message, {
        sceneIndex: update.sceneIndex,
        sceneTotal: update.sceneTotal,
        sceneId: update.sceneId,
      }),
  });

  let finalVideo = manifest.finalVideo;

  if (useExternalTts) {
    await progress("voice", "A gerar voz PT-PT...");
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
      await progress("lipsync", "Lip sync Sync Labs...");
      const syncedDir = path.join(config.outputDir, `synced-${runId}`);
      voicedClips = await lipSyncSceneClips(sceneClips, syncedDir);
    } else {
      await progress("mix", "A mixar áudio (sem lip sync)...");
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
  const exportCopy = copy || {
    title: storyboard.title,
    voiceover: storyboard.voiceover,
    hook: storyboard.hook,
    cta: storyboard.cta,
    language: adConfig.languageVariant || adConfig.language,
    style: storyboard.style,
    parts: storyboard.scenes.map((s) => ({
      id: s.id,
      voiceoverLine: s.voiceoverLine,
      visualBeat: s.visualBeat,
    })),
  };

  await fs.writeFile(copyPath, JSON.stringify(exportCopy, null, 2));

  await progress("done", "Anúncio concluído.", { finalVideo, copyPath });

  return {
    runId,
    storyboardPath,
    storyboard,
    adConfig,
    finalVideo,
    copyPath,
    copy: exportCopy,
    manifest,
  };
}
