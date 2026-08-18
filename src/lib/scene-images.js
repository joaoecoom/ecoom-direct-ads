import fs from "node:fs/promises";
import path from "node:path";
import {
  generateImage,
  generateImageVariation,
  generateImageWithReferences,
} from "./imagen.js";
import { buildIdentityReferencePrompt, buildHumanizedImagePrompt } from "./image-prompts.js";
import { sleep } from "../config.js";

function sceneBeat(scene) {
  return scene.visualBeat || scene.imagePrompt || scene.role || "";
}

function buildScenePrompt(scene, storyboard, sceneIndex, sceneTotal, refNote = "") {
  const brief = [storyboard.characterBrief, storyboard.settingBrief].filter(Boolean).join(". ");
  const beat = sceneBeat(scene);
  const type = scene.sceneType || "ugc";

  if (type === "broll") {
    return `${beat}. B-roll cutaway — NO talking head. Product/lifestyle/detail shot. Same color palette as UGC scenes.${refNote}`;
  }
  if (type === "react_overlay") {
    return `${beat}. UGC react — person reacting to content on phone/screen overlay. Single frame.${refNote}`;
  }

  const prefix = brief
    ? `${brief}. Scene ${sceneIndex + 1}/${sceneTotal} continuous UGC. ${beat}.`
    : `${beat}. Scene ${sceneIndex + 1}/${sceneTotal}.`;
  return `${prefix}${refNote}`.trim();
}

async function generateUgcSceneImage({
  scene,
  sceneIndex,
  sceneTotal,
  storyboard,
  aspectRatio,
  outputPath,
  anchorPath,
  previousPath,
  avatarImagePath,
  referenceImagePaths = [],
  refNote = "",
}) {
  const prompt = buildScenePrompt(scene, storyboard, sceneIndex, sceneTotal, refNote);
  const sceneType = scene.sceneType || "ugc";
  const isBroll = sceneType === "broll";
  const isReact = sceneType === "react_overlay";

  if (isBroll) {
    const brollPrompt = `${prompt} Cinematic B-roll still, product/lifestyle detail, NO face, NO talking head, single frame, premium ad photography.`;
    if (referenceImagePaths.length) {
      await generateImageWithReferences({
        prompt: brollPrompt,
        referenceImagePaths: referenceImagePaths.slice(0, 3),
        outputPath,
        aspectRatio,
        ugc: false,
      });
    } else {
      await generateImage({
        prompt: brollPrompt,
        outputPath,
        aspectRatio,
        ugc: false,
      });
    }
    return;
  }

  if (sceneIndex === 0) {
    if (avatarImagePath) {
      const avatarPrompt = buildIdentityReferencePrompt(
        `${prompt} Same person identity as reference avatar.`,
      );
      await generateImageVariation({
        prompt: avatarPrompt,
        referenceImagePath: avatarImagePath,
        outputPath,
        aspectRatio,
        sceneIndex: 1,
        sceneTotal,
      });
      return;
    }
    if (referenceImagePaths.length) {
      await generateImageWithReferences({
        prompt: buildHumanizedImagePrompt(prompt, { ugc: !isBroll }),
        referenceImagePaths,
        outputPath,
        aspectRatio,
        ugc: !isBroll,
      });
      return;
    }
    await generateImage({
      prompt,
      outputPath,
      aspectRatio,
      ugc: !isBroll,
    });
    return;
  }

  const identityAnchor = anchorPath || avatarImagePath;
  const refPaths = [];
  if (identityAnchor && !isBroll) refPaths.push(identityAnchor);
  if (previousPath && previousPath !== identityAnchor && !isBroll) refPaths.push(previousPath);

  if (isReact && identityAnchor) {
    refPaths.length = 0;
    refPaths.push(identityAnchor);
    if (previousPath && previousPath !== identityAnchor) refPaths.push(previousPath);
  }

  if (refPaths.length >= 1) {
    const reactNote = isReact
      ? " Person reacting to content visible on phone screen overlay. Single frame, one person."
      : "";
    await generateImageWithReferences({
      prompt: buildIdentityReferencePrompt(`${prompt}${reactNote}`, {
        hasPreviousFrame: refPaths.length > 1,
      }),
      referenceImagePaths: refPaths.slice(0, 2),
      outputPath,
      aspectRatio,
      ugc: !isBroll,
    });
    return;
  }

  if (previousPath) {
    await generateImageVariation({
      prompt: sceneBeat(scene),
      referenceImagePath: previousPath,
      outputPath,
      aspectRatio,
      sceneIndex: sceneIndex + 1,
      sceneTotal,
    });
    return;
  }

  await generateImage({
    prompt,
    outputPath,
    aspectRatio,
    ugc: !isBroll,
  });
}

/**
 * Gera imagens para todas as cenas do storyboard (UGC com continuidade).
 */
export async function generateStoryboardImages({
  storyboard,
  adConfig,
  outputDir,
  avatarImagePath = null,
  referenceImagePaths = [],
  onProgress,
}) {
  await fs.mkdir(outputDir, { recursive: true });

  const aspectRatio = storyboard.aspectRatio || adConfig.aspectRatio;
  const isUgc = storyboard.style === "ugc";
  const sceneTotal = storyboard.scenes.length;
  const results = [];
  let previousImagePath = null;
  let anchorPath = avatarImagePath || null;
  const refNote =
    referenceImagePaths.length > 0
      ? " Include the referenced products/props naturally in frame."
      : "";

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

    if (isUgc) {
      await generateUgcSceneImage({
        scene,
        sceneIndex: i,
        sceneTotal,
        storyboard,
        aspectRatio,
        outputPath: imageFile,
        anchorPath,
        previousPath: previousImagePath,
        avatarImagePath,
        referenceImagePaths:
          scene.sceneType === "broll" ? referenceImagePaths : i === 0 ? referenceImagePaths : [],
        refNote,
      });
      if (!anchorPath) anchorPath = imageFile;
    } else {
      await generateImage({
        prompt: scene.imagePrompt,
        outputPath: imageFile,
        aspectRatio,
        ugc: false,
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
  anchorImagePath = null,
  previousImagePath = null,
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

  if (isUgc) {
    await generateUgcSceneImage({
      scene,
      sceneIndex,
      sceneTotal,
      storyboard,
      aspectRatio,
      outputPath: imageFile,
      anchorPath: anchorImagePath,
      previousPath: previousImagePath || (sceneIndex > 0 ? referenceImagePath : null),
      avatarImagePath: anchorImagePath,
      referenceImagePaths: [],
    });
  } else {
    await generateImage({
      prompt: scene.imagePrompt,
      outputPath: imageFile,
      aspectRatio,
      ugc: false,
    });
  }

  return {
    sceneId,
    order: sceneIndex,
    path: imageFile,
    prompt: scene.imagePrompt,
  };
}
