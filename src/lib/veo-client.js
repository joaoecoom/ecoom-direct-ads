import { GoogleGenAI } from "@google/genai";
import { Storage } from "@google-cloud/storage";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ensureOutputDir,
  loadConfig,
  parseGcsUri,
  resolveModelId,
  sleep,
  timestampSlug,
} from "../config.js";
import { normalizeClipDuration as normalizeAdClipDuration } from "./ad-config.js";

export const POLL_MS = 15_000;

export function normalizeClipDuration(seconds = 10) {
  return normalizeAdClipDuration(seconds);
}

export function createClient() {
  const { project, location } = loadConfig();
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
}

export function buildRunPrefix(label = "veo-runs") {
  return `${label}/${timestampSlug()}/`;
}

export function buildOutputGcsUri(prefixLabel) {
  const { gcsOutputUri } = loadConfig();
  const runPrefix = buildRunPrefix(prefixLabel);
  return gcsOutputUri.endsWith("/")
    ? `${gcsOutputUri}${runPrefix}`
    : `${gcsOutputUri}/${runPrefix}`;
}

export async function waitForVideoOperation(client, operation) {
  while (!operation.done) {
    process.stdout.write(".");
    await sleep(POLL_MS);
    operation = await client.operations.get({ operation });
  }
  console.log("");
  return operation;
}

export function extractGcsUriFromOperation(operation) {
  if (operation.error) {
    throw new Error(
      `Veo falhou: ${JSON.stringify(operation.error, null, 2)}`,
    );
  }

  const generated = operation.response?.generatedVideos;
  if (!generated?.length) {
    throw new Error(
      "Veo concluiu mas não devolveu vídeos: " +
        JSON.stringify(operation.response, null, 2),
    );
  }

  const videoRef = generated[0].video;
  const gcsUri = videoRef?.uri || videoRef?.gcsUri;
  if (!gcsUri) {
    throw new Error(
      "Sem URI GCS no vídeo: " + JSON.stringify(videoRef, null, 2),
    );
  }
  return gcsUri;
}

export async function downloadFromGcs(gcsUri, localPath) {
  const { bucket, objectPath } = parseGcsUri(gcsUri);
  const storage = new Storage();
  await storage.bucket(bucket).file(objectPath).download({
    destination: localPath,
  });
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };
  return map[ext] || "image/png";
}

export async function loadImageForVeo(imagePath) {
  const abs = path.resolve(imagePath);
  const buffer = await fs.readFile(abs);
  return {
    imageBytes: buffer.toString("base64"),
    mimeType: mimeFromPath(abs),
    absPath: abs,
  };
}

/**
 * Text-to-video (prompt only)
 */
export async function generateVideoFromText({
  prompt,
  model: modelOverride,
  aspectRatio = "9:16",
  durationSeconds = 8,
  resolution,
  negativePrompt,
  outputFileName,
  runLabel = "veo-runs",
}) {
  const config = loadConfig();
  const model = resolveModelId(modelOverride || config.model);
  const outputGcsUri = buildOutputGcsUri(runLabel);
  await ensureOutputDir(config.outputDir);
  durationSeconds = normalizeClipDuration(durationSeconds);

  const client = createClient();

  console.log("\n🎬 Veo text-to-video");
  console.log(`   Modelo: ${model}`);
  console.log(`   Prompt: ${prompt}`);
  console.log(`   ${aspectRatio} | ${durationSeconds}s${resolution ? ` | ${resolution}` : ""}\n`);

  const videoConfig = {
    aspectRatio,
    outputGcsUri,
    durationSeconds,
  };
  if (resolution) videoConfig.resolution = resolution;
  if (negativePrompt) videoConfig.negativePrompt = negativePrompt;

  const generateAudio = process.env.VEO_GENERATE_AUDIO !== "false";
  if (generateAudio) {
    videoConfig.generateAudio = true;
  }

  // Flow Labs reescreve prompts automaticamente — activar no Vertex
  if (process.env.VEO_ENHANCE_PROMPT !== "false") {
    videoConfig.enhancePrompt = true;
  }

  let operation = await client.models.generateVideos({
    model,
    prompt,
    config: videoConfig,
  });

  operation = await waitForVideoOperation(client, operation);
  const gcsUri = extractGcsUriFromOperation(operation);

  const localName = outputFileName || `veo-${timestampSlug()}.mp4`;
  const localPath = path.join(config.outputDir, localName);
  await downloadFromGcs(gcsUri, localPath);

  console.log(`✅ Clip: ${localPath}\n`);
  return { localPath, gcsUri, model, prompt, type: "text" };
}

import { buildFlowMotionPrompt } from "./image-prompts.js";

/**
 * Image-to-video (imagem + prompt de movimento)
 * Com lastFramePath: Veo interpola suavemente entre 1.ª e última imagem (flow contínuo).
 */
export async function generateVideoFromImage({
  imagePath,
  lastFramePath,
  prompt,
  model: modelOverride,
  aspectRatio = "9:16",
  durationSeconds = 10,
  resolution,
  negativePrompt,
  outputFileName,
  runLabel = "veo-image-runs",
}) {
  const config = loadConfig();
  const model = resolveModelId(modelOverride || config.model);
  const outputGcsUri = buildOutputGcsUri(runLabel);
  await ensureOutputDir(config.outputDir);
  durationSeconds = normalizeClipDuration(durationSeconds);

  const image = await loadImageForVeo(imagePath);
  const client = createClient();

  console.log("\n🖼️  Veo image-to-video");
  console.log(`   Modelo: ${model}`);
  console.log(`   1.º frame: ${image.absPath}`);
  if (lastFramePath) {
    console.log(`   Último frame: ${path.resolve(lastFramePath)}`);
  }
  console.log(`   Motion: ${prompt}`);
  console.log(`   ${aspectRatio} | ${durationSeconds}s${resolution ? ` | ${resolution}` : ""}\n`);

  const videoConfig = {
    aspectRatio,
    outputGcsUri,
    durationSeconds,
  };
  if (resolution) videoConfig.resolution = resolution;
  if (negativePrompt) videoConfig.negativePrompt = negativePrompt;

  if (lastFramePath) {
    const lastFrame = await loadImageForVeo(lastFramePath);
    videoConfig.lastFrame = {
      imageBytes: lastFrame.imageBytes,
      mimeType: lastFrame.mimeType,
    };
  }

  const generateAudio = process.env.VEO_GENERATE_AUDIO !== "false";
  if (generateAudio) {
    videoConfig.generateAudio = true;
  }

  if (process.env.VEO_ENHANCE_PROMPT !== "false") {
    videoConfig.enhancePrompt = true;
  }

  let operation = await client.models.generateVideos({
    model,
    prompt,
    image: {
      imageBytes: image.imageBytes,
      mimeType: image.mimeType,
    },
    config: videoConfig,
  });

  operation = await waitForVideoOperation(client, operation);
  const gcsUri = extractGcsUriFromOperation(operation);

  const localName = outputFileName || `veo-img-${timestampSlug()}.mp4`;
  const localPath = path.join(config.outputDir, localName);
  await downloadFromGcs(gcsUri, localPath);

  console.log(`✅ Clip: ${localPath}\n`);
  return {
    localPath,
    gcsUri,
    model,
    prompt,
    imagePath: image.absPath,
    type: "image",
  };
}
