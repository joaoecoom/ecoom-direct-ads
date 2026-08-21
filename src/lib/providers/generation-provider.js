/**
 * @typedef {'image' | 'video' | 'audio'} GenerationTaskType
 * @typedef {'open' | 'premium' | 'partner'} QualityTier
 * @typedef {'floyo' | 'google' | 'kie' | 'flow'} ProviderId
 */

/**
 * @typedef {object} GenerationRequest
 * @property {GenerationTaskType} taskType
 * @property {string} prompt
 * @property {number} [durationSeconds]
 * @property {string} [aspectRatio]
 * @property {string} [imagePath]
 * @property {string} [lastFramePath]
 * @property {boolean} [audioRequired]
 * @property {boolean} [dialogueRequired]
 * @property {boolean} [lipSyncRequired]
 * @property {boolean} [characterConsistency]
 * @property {boolean} [productConsistency]
 * @property {string} [qualityTarget]
 * @property {string} [budgetTarget]
 * @property {string} [sceneImportance]
 * @property {string} [userSelectedModel]
 * @property {string} [userSelectedProvider]
 * @property {string} [generationMode]
 * @property {boolean} [optimizeForCost]
 * @property {object} [scene]
 * @property {object} [projectMemory]
 * @property {object} [creativeMemory]
 * @property {string} [outputFileName]
 * @property {string} [runLabel]
 * @property {string} [resolution]
 * @property {boolean} [approved]
 */

/**
 * @typedef {object} GenerationResult
 * @property {boolean} ok
 * @property {string} [localPath]
 * @property {string} [remoteUrl]
 * @property {string} provider
 * @property {string} model
 * @property {string} [workflowId]
 * @property {string} [providerRequestId]
 * @property {number|null} [actualCostUsd]
 * @property {number|null} [gpuTimeMs]
 * @property {object} [metadata]
 * @property {string} [error]
 */

/**
 * @typedef {object} CostEstimate
 * @property {number|null} estimatedCostUsd
 * @property {number|null} estimatedGpuTimeMs
 * @property {boolean} costUnknown
 * @property {string} costType
 * @property {string} provider
 * @property {string} model
 * @property {QualityTier} qualityTier
 * @property {string} [note]
 */

/**
 * @typedef {object} ProviderCapabilities
 * @property {GenerationTaskType[]} taskTypes
 * @property {string[]} aspectRatios
 * @property {number[]} durations
 * @property {boolean} textToVideo
 * @property {boolean} imageToVideo
 * @property {boolean} dialogue
 * @property {boolean} lipSync
 * @property {QualityTier} qualityTier
 */

/**
 * @typedef {object} ProviderHealth
 * @property {ProviderId} id
 * @property {string} name
 * @property {'connected' | 'disconnected' | 'degraded' | 'unknown'} status
 * @property {string} [message]
 * @property {number|null} [latencyMs]
 * @property {number} [errorCount]
 * @property {string|null} [lastRequestAt]
 * @property {string|null} [lastError]
 */

/**
 * Base contract for generation providers (server-side only).
 * @typedef {object} GenerationProvider
 * @property {ProviderId} id
 * @property {string} name
 * @property {(request: GenerationRequest) => Promise<GenerationResult>} generateVideo
 * @property {(request: GenerationRequest) => Promise<GenerationResult>} [generateImage]
 * @property {(request: GenerationRequest) => Promise<GenerationResult>} [generateAudio]
 * @property {(request: GenerationRequest, modelId?: string) => CostEstimate} estimateCost
 * @property {(modelId?: string) => ProviderCapabilities} getCapabilities
 * @property {() => Promise<ProviderHealth>} healthCheck
 */

const providerRegistry = new Map();

/** @param {GenerationProvider} provider */
export function registerProvider(provider) {
  providerRegistry.set(provider.id, provider);
}

/** @param {ProviderId} id */
export function getProvider(id) {
  return providerRegistry.get(id) || null;
}

export function listProviders() {
  return [...providerRegistry.values()];
}

export function ensureProvider(id) {
  const p = getProvider(id);
  if (!p) throw new Error(`Provider "${id}" não registado`);
  return p;
}
