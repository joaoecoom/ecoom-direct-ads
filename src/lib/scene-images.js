import fs from "node:fs/promises";
import path from "node:path";
import { generateImage, generateImageVariation } from "./imagen.js";
import { sleep } from "../config.js";

/**
 * Gera imagens para todas as cenas do storyboard (UGC com continuidade).
 * @param {{ storyboard: object, adConfig: object, outputDir: string, onProgress?: Function }} params
 */
export async function generateStoryboardImages({
  storyboard,
  adConfig,
  outputDir,
  onProgress,
}) {
  await fs.mkdir(outputDir, { recursive: true });

  const aspectRatio = storyboard.aspectRatio || adConfig.aspectRatio;
  const isUgc = storyboard.style === "ugc";
  const sceneTotal = storyboard.scenes.length;
  const results = [];
  let previousImagePath = null;

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const id = scene.id || `parte-${i + 1}`;
    const imageFile = path.join(outputDir, `${id}.png`);

    onProgress?.({
      step: "image",
      sceneIndex: i + 1,
      sceneTotal,
      sceneId: id,
      message: `Imagem ${i + 1}/${sceneTotal}: ${id}`,
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
    results.push({
      sceneId: id,
      order: i,
      path: imageFile,
      prompt: scene.imagePrompt,
      visualBeat: scene.visualBeat,
    });

    if (i < sceneTotal - 1) await sleep(3000);
  }

  return { images: results, outputDir };
}

/**
 * Regenera imagem de uma única cena (com referência se UGC e não for cena 1).
 */
export async function regenerateSceneImage({
  storyboard,
  adConfig,
  sceneId,
  outputDir,
  referenceImagePath = null,
}) {
  await fs.mkdir(outputDir, { recursive: true });
  const aspectRatio = storyboard.aspectRatio || adConfig.aspectRatio;
  const isUgc = storyboard.style === "ugc";
  const sceneIndex = storyboard.scenes.findIndex(
    (s, i) => (s.id || `parte-${i + 1}`) === sceneId,
  );
  if (sceneIndex === -1) throw new Error(`Cena ${sceneId} não encontrada`);

  const scene = storyboard.scenes[sceneIndex];
  const imageFile = path.join(outputDir, `${sceneId}.png`);
  const sceneTotal = storyboard.scenes.length;

  if (isUgc && sceneIndex === 0) {
    await generateImage({
      prompt: scene.imagePrompt,
      outputPath: imageFile,
      aspectRatio,
      ugc: true,
    });
  } else if (isUgc && referenceImagePath) {
    await generateImageVariation({
      prompt: scene.visualBeat || scene.imagePrompt,
      referenceImagePath,
      outputPath: imageFile,
      aspectRatio,
      sceneIndex: sceneIndex + 1,
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

  return {
    sceneId,
    order: sceneIndex,
    path: imageFile,
    prompt: scene.imagePrompt,
  };
}
