import path from "node:path";
import { ensureOutputDir } from "../config.js";
import {
  buildFlowMotionPrompt,
  buildVeoMotionPromptWithDialogue,
  stripDialogueFromMotionPrompt,
} from "./image-prompts.js";
import { generateVideoFromImage } from "./veo-client.js";
import { isUgcStoryboard, shouldUseUgcFlow } from "./ugc-flow.js";
import { generateSceneVideoRouted } from "./generation-service.js";
import { routeSceneVideoGeneration } from "./model-router.js";

function useAiRouter() {
  return process.env.AI_ROUTER_ENABLED !== "false";
}

export function buildSceneVeoPrompt(
  storyboard,
  scene,
  adConfig,
  motionPromptOverride,
  { bridging = false } = {},
) {
  const clipDuration =
    storyboard.durationSeconds || adConfig.clipDurationSeconds || 8;
  const isUgc = isUgcStoryboard(storyboard, adConfig);
  const ttsEngine = process.env.TTS_ENGINE || "auto";
  const veoAudioEnabled = process.env.VEO_GENERATE_AUDIO !== "false";
  const useVeoNativeAudio =
    isUgc &&
    veoAudioEnabled &&
    (adConfig.languageVariant !== "pt-PT" || ttsEngine === "veo");

  const motionBase = stripDialogueFromMotionPrompt(
    motionPromptOverride ||
      scene.motionPrompt ||
      buildFlowMotionPrompt(clipDuration, scene.visualBeat, { bridging }),
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
  motionPromptOverride,
  generationApproved = false,
  onFallbackConfirm,
}) {
  const clipDuration =
    storyboard.durationSeconds || adConfig.clipDurationSeconds || 8;
  const aspectRatio = storyboard.aspectRatio || adConfig.aspectRatio;
  const resolution = storyboard.resolution || adConfig.resolution;
  const useFlow =
    shouldUseUgcFlow(storyboard, adConfig, sceneTotal) && lastFramePath;

  const storyboardScene =
    storyboard.scenes?.[sceneIndex] ||
    storyboard.scenes?.find((s, i) => (s.id || `parte-${i + 1}`) === scene.id) ||
    scene;

  const sceneType = storyboardScene.sceneType || "ugc";

  if (sceneType === "broll") {
    const brollMotion =
      motionPromptOverride ||
      storyboardScene.motionPrompt ||
      "Slow cinematic B-roll camera move, product/lifestyle detail, shallow depth of field, smooth motion, no talking head.";
    const id = scene.id || `parte-${sceneIndex + 1}`;
    await ensureOutputDir(outputDir);
    const outputFileName = path.join(outputDir, `${id}.mp4`);

    if (useAiRouter()) {
      const route = routeSceneVideoGeneration({
        scene: storyboardScene,
        storyboard,
        adConfig,
        imagePath,
      });
      console.log(`🎬 B-roll [${route.provider}/${route.model}]: ${id}…`);
      return generateSceneVideoRouted({
        storyboard,
        adConfig,
        scene: storyboardScene,
        sceneIndex,
        imagePath,
        lastFramePath: useFlow ? lastFramePath : undefined,
        outputFileName,
        runLabel: runLabel || `broll/${id}`,
        motionPromptOverride: brollMotion,
        prompt: brollMotion,
        approved: generationApproved,
        onFallbackConfirm,
      });
    }

    console.log(`🎬 B-roll Veo: ${id}…`);
    const clip = await generateVideoFromImage({
      imagePath,
      lastFramePath: useFlow ? lastFramePath : undefined,
      prompt: brollMotion,
      aspectRatio,
      durationSeconds: clipDuration,
      resolution,
      outputFileName,
      runLabel: runLabel || `veo-broll/${id}`,
    });
    return { sceneId: id, path: clip.localPath, prompt: brollMotion, order: sceneIndex };
  }

  const prompt = buildSceneVeoPrompt(
    storyboard,
    storyboardScene,
    adConfig,
    motionPromptOverride,
    { bridging: useFlow },
  );
  const id = scene.id || `parte-${sceneIndex + 1}`;

  await ensureOutputDir(outputDir);
  const outputFileName = path.join(outputDir, `${id}.mp4`);

  if (useAiRouter()) {
    const route = routeSceneVideoGeneration({
      scene: storyboardScene,
      storyboard,
      adConfig,
      imagePath,
    });
    console.log(`🎬 Scene [${route.provider}/${route.model}]: ${id}…`);
    return generateSceneVideoRouted({
      storyboard,
      adConfig,
      scene: storyboardScene,
      sceneIndex,
      imagePath,
      lastFramePath: useFlow ? lastFramePath : undefined,
      outputFileName,
      runLabel: runLabel || `scene/${id}`,
      motionPromptOverride,
      prompt,
      approved: generationApproved,
      onFallbackConfirm,
    });
  }

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
  generationApproved = false,
  onFallbackConfirm,
}) {
  const sceneTotal = scenes.length;
  const isUgcFlow = shouldUseUgcFlow(storyboard, adConfig, sceneTotal);
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
    if (isUgcFlow && i < scenes.length - 1) {
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
      generationApproved,
      onFallbackConfirm,
    });

    clips.push(result);
  }

  return { clips, clipCount: clips.length, veoFlow: isUgcFlow };
}
