/**
 * Central model + workflow registry. Workflow IDs are env-configurable — never hardcoded.
 * Cost/heuristic scores are ESTIMATES unless provider returns actual billing.
 */

/** @typedef {import('./generation-provider.js').QualityTier} QualityTier */

/**
 * @typedef {object} FloyoWorkflowDefinition
 * @property {string} provider
 * @property {string} workflowIdEnv
 * @property {string} model
 * @property {string} taskType
 * @property {QualityTier} qualityTier
 * @property {string} costType
 * @property {number|null} estimatedGpuTimeMs
 * @property {number|null} estimatedCostUsdPerRun
 * @property {string[]} capabilities
 * @property {string[]} supportedAspectRatios
 * @property {number[]} supportedDurations
 * @property {string} [inputPatchEnv]
 * @property {string} [notes]
 */

/** @type {Record<string, FloyoWorkflowDefinition & { id: string, providerId: string }>} */
export const MODEL_REGISTRY = {
  "floyo:ltx-2.3:t2v": {
    id: "floyo:ltx-2.3:t2v",
    providerId: "floyo",
    provider: "floyo",
    model: "ltx-2.3",
    workflowIdEnv: "FLOYO_WORKFLOW_LTX23_TEXT_TO_VIDEO",
    taskType: "text-to-video",
    qualityTier: "open",
    costType: "gpu_time",
    estimatedGpuTimeMs: 160000,
    estimatedCostUsdPerRun: null,
    capabilities: ["text-to-video", "b-roll", "background", "product-motion"],
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    supportedDurations: [4, 6, 8],
    inputPatchEnv: "FLOYO_PATCH_LTX23_T2V",
    notes: "Heuristic estimate — configure workflow ID in env",
  },
  "floyo:ltx-2.3:i2v": {
    id: "floyo:ltx-2.3:i2v",
    providerId: "floyo",
    provider: "floyo",
    model: "ltx-2.3",
    workflowIdEnv: "FLOYO_WORKFLOW_LTX23_IMAGE_TO_VIDEO",
    taskType: "image-to-video",
    qualityTier: "open",
    costType: "gpu_time",
    estimatedGpuTimeMs: 160000,
    estimatedCostUsdPerRun: null,
    capabilities: ["image-to-video", "b-roll", "product", "background"],
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    supportedDurations: [4, 6, 8],
    inputPatchEnv: "FLOYO_PATCH_LTX23_I2V",
  },
  "floyo:wan-2.2:i2v": {
    id: "floyo:wan-2.2:i2v",
    providerId: "floyo",
    provider: "floyo",
    model: "wan-2.2",
    workflowIdEnv: "FLOYO_WORKFLOW_WAN22_IMAGE_TO_VIDEO",
    taskType: "image-to-video",
    qualityTier: "open",
    costType: "gpu_time",
    estimatedGpuTimeMs: 180000,
    estimatedCostUsdPerRun: null,
    capabilities: ["image-to-video", "cinematic-motion", "product-animation"],
    supportedAspectRatios: ["9:16", "16:9", "1:1"],
    supportedDurations: [4, 6, 8],
    inputPatchEnv: "FLOYO_PATCH_WAN22_I2V",
  },
  "google:veo-3.1-fast": {
    id: "google:veo-3.1-fast",
    providerId: "google",
    provider: "google",
    model: "veo-3.1-fast-generate-001",
    workflowIdEnv: "",
    taskType: "image-to-video",
    qualityTier: "premium",
    costType: "cloud_api",
    estimatedGpuTimeMs: null,
    estimatedCostUsdPerRun: null,
    capabilities: ["text-to-video", "image-to-video", "dialogue", "ugc"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedDurations: [4, 6, 8, 10],
  },
  "google:veo-3.1-lite": {
    id: "google:veo-3.1-lite",
    providerId: "google",
    provider: "google",
    model: "veo-3.1-lite-generate-001",
    workflowIdEnv: "",
    taskType: "image-to-video",
    qualityTier: "premium",
    costType: "cloud_api",
    estimatedGpuTimeMs: null,
    estimatedCostUsdPerRun: null,
    capabilities: ["text-to-video", "image-to-video"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedDurations: [4, 6, 8],
  },
  "kie:kling": {
    id: "kie:kling",
    providerId: "kie",
    provider: "kie",
    model: "kling",
    workflowIdEnv: "KIE_MODEL_KLING",
    taskType: "image-to-video",
    qualityTier: "partner",
    costType: "partner_api",
    estimatedGpuTimeMs: null,
    estimatedCostUsdPerRun: null,
    capabilities: ["image-to-video", "cinematic-motion"],
    supportedAspectRatios: ["9:16", "16:9"],
    supportedDurations: [5, 10],
    notes: "Stub — configure KIE when integrated",
  },
};

export function resolveWorkflowId(entry) {
  if (!entry?.workflowIdEnv) return null;
  return process.env[entry.workflowIdEnv] || null;
}

export function getModelEntry(modelId) {
  return MODEL_REGISTRY[modelId] || null;
}

export function listModelEntries({ providerId, taskType, qualityTier } = {}) {
  return Object.values(MODEL_REGISTRY).filter((m) => {
    if (providerId && m.providerId !== providerId) return false;
    if (taskType && m.taskType !== taskType && !m.capabilities?.includes(taskType)) return false;
    if (qualityTier && m.qualityTier !== qualityTier) return false;
    return true;
  });
}

export function getConfiguredModels() {
  return Object.values(MODEL_REGISTRY).map((entry) => ({
    ...entry,
    workflowId: resolveWorkflowId(entry),
    configured: entry.providerId === "google" || Boolean(resolveWorkflowId(entry)),
  }));
}
