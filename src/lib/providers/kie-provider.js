import { getModelEntry } from "./model-registry.js";

/** KIE provider stub — wired when KIE_API_KEY is configured. */
export const kieProvider = {
  id: "kie",
  name: "KIE",

  getCapabilities(modelId = "kie:kling") {
    const entry = getModelEntry(modelId);
    return {
      taskTypes: ["video"],
      aspectRatios: entry?.supportedAspectRatios || ["9:16"],
      durations: entry?.supportedDurations || [5, 10],
      textToVideo: false,
      imageToVideo: true,
      dialogue: false,
      lipSync: false,
      qualityTier: "partner",
    };
  },

  estimateCost(_request, modelId = "kie:kling") {
    const entry = getModelEntry(modelId);
    return {
      estimatedCostUsd: null,
      estimatedGpuTimeMs: null,
      costUnknown: true,
      costType: "partner_api",
      provider: "kie",
      model: entry?.model || "kling",
      qualityTier: "partner",
      note: "COST UNKNOWN — KIE não integrado nesta fase",
    };
  },

  async healthCheck() {
    const key = process.env.KIE_API_KEY;
    return {
      id: "kie",
      name: "KIE",
      status: key ? "degraded" : "disconnected",
      message: key ? "API key presente — integração pendente" : "KIE_API_KEY não configurada",
      errorCount: 0,
      lastRequestAt: null,
      lastError: null,
    };
  },

  async generateVideo(_request, modelId = "kie:kling") {
    return {
      ok: false,
      provider: "kie",
      model: getModelEntry(modelId)?.model || "kling",
      error: "KIE provider não implementado — use fallback Google/Floyo",
    };
  },
};
