import fs from "node:fs/promises";
import path from "node:path";
import { Modality, createPartFromBase64, createPartFromText } from "@google/genai";
import { createClient } from "./veo-client.js";
import { sleep } from "../config.js";
import {
  buildHumanizedImagePrompt,
  buildHumanizedVariationPrompt,
} from "./image-prompts.js";

/** Nano Banana Pro (GA) — fallback preview se necessário */
const DEFAULT_MODEL =
  process.env.GEMINI_IMAGE_MODEL ||
  process.env.IMAGE_MODEL ||
  "gemini-3-pro-image";

const FALLBACK_MODEL = "gemini-3-pro-image-preview";

const IMAGE_RETRY_MS = 12_000;
const IMAGE_MAX_RETRIES = 4;

function extractImageBytes(response) {
  if (response.data) return response.data;
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) return part.inlineData.data;
  }
  return null;
}

async function writeImageResponse(response, outputPath) {
  const imageBytes = extractImageBytes(response);
  if (!imageBytes) {
    throw new Error(
      "Gemini Image não devolveu imagem: " +
        JSON.stringify(response, null, 2).slice(0, 500),
    );
  }
  const absPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(imageBytes, "base64"));
  return absPath;
}

async function withRetry(label, fn) {
  for (let attempt = 1; attempt <= IMAGE_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || String(err);
      const is429 = msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");
      const is404 = msg.includes("404") || msg.includes("NOT_FOUND");
      if (is404 && attempt === 1) throw err;
      if (!is429 || attempt === IMAGE_MAX_RETRIES) throw err;
      console.log(
        `   ⏳ ${label}: rate limit — retry ${attempt}/${IMAGE_MAX_RETRIES}...\n`,
      );
      await sleep(IMAGE_RETRY_MS);
    }
  }
}

async function callGenerateImage(client, { model, contents, aspectRatio, imageSize }) {
  const imageConfig = { aspectRatio };
  if (imageSize) imageConfig.imageSize = imageSize;

  return client.models.generateContent({
    model,
    contents,
    config: {
      responseModalities: [Modality.IMAGE],
      imageConfig,
    },
  });
}

/**
 * Gera imagem — Nano Banana Pro por default, humanizada para UGC.
 */
export async function generateImage({
  prompt,
  outputPath,
  aspectRatio = "9:16",
  model = DEFAULT_MODEL,
  ugc = false,
  imageSize = process.env.GEMINI_IMAGE_SIZE || "2K",
}) {
  const client = createClient();
  const finalPrompt = buildHumanizedImagePrompt(prompt, { ugc });

  console.log("🎨 Nano Banana Pro — imagem...");
  console.log(`   Modelo: ${model}`);
  console.log(`   Prompt: ${finalPrompt.slice(0, 140)}...\n`);

  return withRetry("Imagem", async () => {
    try {
      const response = await callGenerateImage(client, {
        model,
        contents: finalPrompt,
        aspectRatio,
        imageSize,
      });
      const absPath = await writeImageResponse(response, outputPath);
      console.log(`✅ Imagem: ${absPath}\n`);
      return absPath;
    } catch (err) {
      if (
        model === DEFAULT_MODEL &&
        FALLBACK_MODEL !== model &&
        (err.message?.includes("404") || err.message?.includes("NOT_FOUND"))
      ) {
        console.log(`   ↪ A usar fallback ${FALLBACK_MODEL}\n`);
        const response = await callGenerateImage(client, {
          model: FALLBACK_MODEL,
          contents: finalPrompt,
          aspectRatio,
          imageSize,
        });
        const absPath = await writeImageResponse(response, outputPath);
        console.log(`✅ Imagem: ${absPath}\n`);
        return absPath;
      }
      throw err;
    }
  });
}

/**
 * Variação progressiva — referência à cena anterior (flow contínuo).
 */
export async function generateImageVariation({
  prompt,
  referenceImagePath,
  outputPath,
  aspectRatio = "9:16",
  sceneIndex = 1,
  sceneTotal = 4,
  model = DEFAULT_MODEL,
  imageSize = process.env.GEMINI_IMAGE_SIZE || "2K",
}) {
  const client = createClient();
  const refBuffer = await fs.readFile(path.resolve(referenceImagePath));
  const refBase64 = refBuffer.toString("base64");

  const continuityPrompt = buildHumanizedVariationPrompt(
    prompt,
    sceneIndex,
    sceneTotal,
  );

  console.log(`🎨 Variação cena ${sceneIndex}/${sceneTotal} (ref. cena anterior)...`);
  console.log(`   Beat: ${prompt.slice(0, 90)}...\n`);

  return withRetry(`Variação ${sceneIndex}`, async () => {
    const contents = [
      createPartFromText(continuityPrompt),
      createPartFromBase64(refBase64, "image/png"),
    ];

    try {
      const response = await callGenerateImage(client, {
        model,
        contents,
        aspectRatio,
        imageSize,
      });
      const absPath = await writeImageResponse(response, outputPath);
      console.log(`✅ Variação: ${absPath}\n`);
      return absPath;
    } catch (err) {
      if (model === DEFAULT_MODEL && err.message?.includes("404")) {
        const response = await callGenerateImage(client, {
          model: FALLBACK_MODEL,
          contents,
          aspectRatio,
          imageSize,
        });
        const absPath = await writeImageResponse(response, outputPath);
        console.log(`✅ Variação: ${absPath}\n`);
        return absPath;
      }
      throw err;
    }
  });
}
