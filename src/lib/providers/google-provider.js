import { generateVideoFromImage, generateVideoFromText } from "../veo-client.js";
import { getModelEntry } from "./model-registry.js";

const stats = {
  lastRequestAt: null,
  lastError: null,
  errorCount: 0,
};

export const googleProvider = {
  id: "google",
  name: "Google Vertex / Veo",

  getCapabilities(modelId = "google:veo-3.1-fast") {
    const entry = getModelEntry(modelId);
    return {
      taskTypes: ["video"],
      aspectRatios: entry?.supportedAspectRatios || ["9:16", "16:9"],
      durations: entry?.supportedDurations || [8, 10],
      textToVideo: true,
      imageToVideo: true,
      dialogue: true,
      lipSync: false,
      qualityTier: entry?.qualityTier || "premium",
    };
  },

  estimateCost(_request, modelId = "google:veo-3.1-fast") {
    const entry = getModelEntry(modelId);
    return {
      estimatedCostUsd: null,
      estimatedGpuTimeMs: null,
      costUnknown: true,
      costType: entry?.costType || "cloud_api",
      provider: "google",
      model: entry?.model || process.env.VEO_MODEL,
      qualityTier: entry?.qualityTier || "premium",
      note: "COST UNKNOWN — Vertex billing externo",
    };
  },

  async healthCheck() {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      return {
        id: "google",
        name: "Google Vertex / Veo",
        status: "disconnected",
        message: "GOOGLE_CLOUD_PROJECT não configurado",
        errorCount: stats.errorCount,
        lastRequestAt: stats.lastRequestAt,
        lastError: stats.lastError,
      };
    }
    return {
      id: "google",
      name: "Google Vertex / Veo",
      status: "connected",
      message: `Projecto ${project}`,
      errorCount: stats.errorCount,
      lastRequestAt: stats.lastRequestAt,
      lastError: stats.lastError,
    };
  },

  async generateVideo(request, modelId = "google:veo-3.1-fast") {
    const entry = getModelEntry(modelId);
    const model = entry?.model || process.env.VEO_MODEL;

    try {
      stats.lastRequestAt = new Date().toISOString();
      let clip;

      if (request.imagePath) {
        clip = await generateVideoFromImage({
          imagePath: request.imagePath,
          lastFramePath: request.lastFramePath,
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          durationSeconds: request.durationSeconds,
          resolution: request.resolution,
          outputFileName: request.outputFileName,
          runLabel: request.runLabel,
          model,
        });
      } else {
        clip = await generateVideoFromText({
          prompt: request.prompt,
          aspectRatio: request.aspectRatio,
          durationSeconds: request.durationSeconds,
          resolution: request.resolution,
          outputFileName: request.outputFileName,
          runLabel: request.runLabel,
          model,
        });
      }

      return {
        ok: true,
        localPath: clip.localPath,
        provider: "google",
        model,
        providerRequestId: clip.operationName || null,
        actualCostUsd: null,
        gpuTimeMs: null,
        metadata: { costUnknown: true },
      };
    } catch (err) {
      stats.errorCount += 1;
      stats.lastError = err.message;
      return {
        ok: false,
        provider: "google",
        model,
        error: err.message,
      };
    }
  },
};
