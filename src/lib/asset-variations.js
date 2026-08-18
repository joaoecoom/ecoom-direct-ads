import path from "node:path";
import { sleep } from "../config.js";
import { generateImageVariation } from "./imagen.js";

const MAX_VARIATIONS = 12;

/**
 * Gera N variações UGC a partir de uma imagem de referência (expert, produto, etc.).
 */
export async function generateAssetVariations({
  referenceImagePath,
  prompt,
  count = 5,
  outputDir,
  aspectRatio = "9:16",
  onProgress,
}) {
  const total = Math.min(Math.max(1, count), MAX_VARIATIONS);
  await sleep(0);

  const results = [];
  for (let i = 0; i < total; i++) {
    const fileName = `variation-${String(i + 1).padStart(2, "0")}.png`;
    const outputPath = path.join(outputDir, fileName);

    onProgress?.({
      step: "image",
      sceneIndex: i + 1,
      sceneTotal: total,
      message: `Variação ${i + 1}/${total}`,
    });

    const beat =
      prompt?.trim() ||
      `UGC variation ${i + 1} — same person, different natural expression and subtle environment shift`;

    await generateImageVariation({
      prompt: beat,
      referenceImagePath,
      outputPath,
      aspectRatio,
      sceneIndex: i + 1,
      sceneTotal: total,
    });

    results.push({ path: outputPath, prompt: beat, order: i });
    if (i < total - 1) await sleep(4000);
  }

  return { variations: results, count: results.length };
}

export { MAX_VARIATIONS };
