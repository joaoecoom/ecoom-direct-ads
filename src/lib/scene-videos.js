import path from "node:path";
import { ensureOutputDir } from "../config.js";
import {
  buildFlowMotionPrompt,
  buildVeoMotionPromptWithDialogue,
  stripDialogueFromMotionPrompt,
} from "./image-prompts.js";
import { generateVideoFromImage } from "./veo-client.js";

export function buildSceneVeoPrompt(storyboard, scene, adConfig) {
  const clipDuration =
    storyboard.durationSeconds || adConfig.clipDurationSeconds || 8;
  const isUgc = storyboard.style === "ugc";
  const ttsEngine = process.env.TTS_ENGINE || "auto";
  const veoAudioEnabled = process.env.VEO_GENERATE_AUDIO !== "false";
  const useVeoNativeAudio =
    isUgc &&
    veoAudioEnabled &&
    (adConfig.languageVariant !== "pt-PT" || ttsEngine === "veo");

  const motionBase = stripDialogueFromMotionPrompt(
    scene.motionPrompt ||
      buildFlowMotionPrompt(clipDuration, scene.visualBeat),
  );

  if (useVeoNativeAudio) {
    return buildVeoMotionPromptWithDialogue({
      motionBase,
      voiceoverLine: scene.voiceoverLine,
      languageVariant: adConfig.languageVariant,
      clipDurationSeconds: clipDuration,
    });
  }

  return `${motionBase} Person speaking naturally to camera, visible mouth movement mid-speech, subtle lip motion, preserve identity.`;
}

/**
 * Anima uma cena (imagem → clip Veo). Reutiliza imagem existente — não regenera.
 */
export async function animateSceneVideo({
  storyboard,
  adConfig,
  scene,
  sceneIndex,
  sceneTotal,
  imagePath,
  lastFramePath,
  outputDir,
  runLabel,
}) {
  const clipDuration =
    storyboard.durationSeconds || adConfig.clipDurationSeconds || 8;
  const aspectRatio = storyboard.aspectRatio || adConfig.aspectRatio;
  const resolution = storyboard.resolution || adConfig.resolution;
  const isUgc = storyboard.style === "ugc";
  const useFlow = isUgc && sceneTotal > 1 && lastFramePath;

  const storyboardScene =
    storyboard.scenes?.[sceneIndex] ||
    storyboard.scenes?.find((s, i) => (s.id || `parte-${i + 1}`) === scene.id) ||
    scene;

  const prompt = buildSceneVeoPrompt(storyboard, storyboardScene, adConfig);
  const id = scene.id || `parte-${sceneIndex + 1}`;

  await ensureOutputDir(outputDir);
  const outputFileName = path.join(outputDir, `${id}.mp4`);

  const clip = await generateVideoFromImage({
    imagePath,
    lastFramePath: useFlow ? lastFramePath : undefined,
    prompt,
    aspectRatio,
    durationSeconds: clipDuration,
    resolution,
    outputFileName,
    runLabel: runLabel || `veo-scene/${id}`,
  });

  return { sceneId: id, path: clip.localPath, prompt, order: sceneIndex };
}

/**
 * Animate All — cada cena usa a imagem já gerada; flow UGC entre frames consecutivos.
 */
export async function animateAllSceneVideos({
  storyboard,
  adConfig,
  scenes,
  getImagePath,
  outputDir,
  onProgress,
}) {
  const sceneTotal = scenes.length;
  const isUgc = storyboard.style === "ugc";
  const clips = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneId = scene.id || `parte-${i + 1}`;

    onProgress?.({
      step: "video",
      sceneIndex: i + 1,
      sceneTotal,
      sceneId,
      message: `Animating scenes... ${i + 1} / ${sceneTotal} — ${sceneId}`,
    });

    const imagePath = await getImagePath(scene);
    let lastFramePath = null;
    if (isUgc && i < scenes.length - 1) {
      lastFramePath = await getImagePath(scenes[i + 1]);
    }

    const result = await animateSceneVideo({
      storyboard,
      adConfig,
      scene,
      sceneIndex: i,
      sceneTotal,
      imagePath,
      lastFramePath,
      outputDir,
      runLabel: `veo-project/${sceneId}`,
    });

    clips.push(result);
  }

  return { clips, clipCount: clips.length };
}
