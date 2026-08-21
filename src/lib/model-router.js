import { enrichSceneProductionMeta } from "./scene-classification.js";
import { getModelEntry, listModelEntries, resolveWorkflowId } from "./providers/model-registry.js";
import { isFloyoConfigured } from "./providers/floyo-client.js";

/**
 * generationScore = quality + consistency + capability - costPenalty
 * HEURISTIC ONLY — not an official benchmark.
 */
function scoreModel(entry, request, sceneMeta) {
  let qualityScore = entry.qualityTier === "premium" ? 90 : entry.qualityTier === "partner" ? 75 : 55;
  let consistencyScore = 40;
  let capabilityScore = 0;
  let costPenalty = entry.qualityTier === "premium" ? 40 : entry.qualityTier === "partner" ? 25 : 5;

  const caps = entry.capabilities || [];
  const task = request.taskType || (request.imagePath ? "image-to-video" : "text-to-video");

  if (task === "text-to-video" && caps.includes("text-to-video")) capabilityScore += 30;
  if (task === "image-to-video" && caps.includes("image-to-video")) capabilityScore += 30;
  if (sceneMeta.dialogueRequired && caps.includes("dialogue")) capabilityScore += 40;
  if (sceneMeta.lipSyncRequired && caps.includes("lip-sync")) capabilityScore += 50;
  if (sceneMeta.characterConsistency && entry.qualityTier === "premium") consistencyScore += 35;
  if (["BROLL", "BACKGROUND", "PRODUCT"].includes(sceneMeta.sceneProductionClass)) {
    if (entry.qualityTier === "open") capabilityScore += 20;
  }
  if (sceneMeta.sceneQualityRequirement === "PREMIUM" && entry.qualityTier !== "premium") {
    qualityScore -= 30;
    capabilityScore -= 20;
  }

  if (request.optimizeForCost !== false) {
    costPenalty *= 1.5;
  }

  return qualityScore + consistencyScore + capabilityScore - costPenalty;
}

function isModelAvailable(entry) {
  if (entry.providerId === "google") {
    return Boolean(process.env.GOOGLE_CLOUD_PROJECT);
  }
  if (entry.providerId === "floyo") {
    return isFloyoConfigured() && Boolean(resolveWorkflowId(entry));
  }
  if (entry.providerId === "kie") {
    return Boolean(process.env.KIE_API_KEY);
  }
  return false;
}

function pickCandidates(request, sceneMeta) {
  const taskType = request.taskType || (request.imagePath ? "image-to-video" : "text-to-video");
  let candidates = listModelEntries({ taskType });

  if (sceneMeta.sceneQualityRequirement === "PREMIUM" || sceneMeta.dialogueRequired || sceneMeta.lipSyncRequired) {
    candidates = candidates.filter((c) => c.qualityTier === "premium" || c.qualityTier === "partner");
  } else if (request.generationMode === "cheapest" || request.optimizeForCost) {
    candidates = candidates.filter((c) => c.qualityTier === "open");
  } else if (request.generationMode === "best_quality") {
    candidates = candidates.sort((a, b) => (a.qualityTier === "premium" ? -1 : 1));
  }

  if (request.userSelectedProvider && request.userSelectedProvider !== "auto") {
    candidates = candidates.filter((c) => c.providerId === request.userSelectedProvider);
  }
  if (request.userSelectedModel && request.userSelectedModel !== "auto" && request.userSelectedModel !== "best_value") {
    const direct = getModelEntry(request.userSelectedModel);
    if (direct) return [direct];
  }

  return candidates.filter(isModelAvailable);
}

function buildRouteFromEntry(entry, request, sceneMeta, reasoning) {
  const fallbackChain = [];
  if (entry.id === "floyo:ltx-2.3:i2v" || entry.id === "floyo:ltx-2.3:t2v") {
    fallbackChain.push("floyo:wan-2.2:i2v", "kie:kling", "google:veo-3.1-fast");
  } else if (entry.qualityTier === "open") {
    fallbackChain.push("google:veo-3.1-lite", "google:veo-3.1-fast");
  }

  const fallbackId = fallbackChain.find((id) => {
    const e = getModelEntry(id);
    return e && isModelAvailable(e);
  });

  const fallbackEntry = fallbackId ? getModelEntry(fallbackId) : null;

  return {
    provider: entry.providerId,
    model: entry.model,
    modelId: entry.id,
    workflowId: resolveWorkflowId(entry),
    taskType: entry.taskType,
    qualityTier: entry.qualityTier,
    estimatedCost: entry.estimatedCostUsdPerRun,
    estimatedGpuTimeMs: entry.estimatedGpuTimeMs,
    reasoning,
    fallbackProvider: fallbackEntry?.providerId || null,
    fallbackModel: fallbackEntry?.model || null,
    fallbackModelId: fallbackEntry?.id || null,
    sceneProductionClass: sceneMeta.sceneProductionClass,
    sceneQualityRequirement: sceneMeta.sceneQualityRequirement,
    heuristic: true,
  };
}

/**
 * @param {import('./providers/generation-provider.js').GenerationRequest} request
 */
export function routeGeneration(request) {
  const scene = request.scene || {};
  const sceneMeta = enrichSceneProductionMeta(scene, request.storyboard || {});

  if (request.userSelectedModel && request.userSelectedModel !== "auto" && request.userSelectedModel !== "best_value") {
    const entry = getModelEntry(request.userSelectedModel);
    if (entry && isModelAvailable(entry)) {
      return buildRouteFromEntry(entry, request, sceneMeta, "Modelo seleccionado manualmente pelo utilizador");
    }
  }

  const candidates = pickCandidates(request, sceneMeta);
  if (!candidates.length) {
    const google = getModelEntry("google:veo-3.1-fast");
    return buildRouteFromEntry(
      google,
      request,
      sceneMeta,
      "Fallback — nenhum modelo open-source configurado; Vertex Veo",
    );
  }

  const ranked = candidates
    .map((entry) => ({
      entry,
      score: scoreModel(entry, request, sceneMeta),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0].entry;
  const mode = request.generationMode || "auto";
  let reasoning = `Auto — score heurístico ${ranked[0].score.toFixed(0)} (${best.model}, ${best.qualityTier})`;

  if (["BROLL", "BACKGROUND"].includes(sceneMeta.sceneProductionClass)) {
    reasoning = `B-roll/background → preferir open-source (${best.model})`;
  } else if (sceneMeta.sceneQualityRequirement === "PREMIUM") {
    reasoning = `UGC/diálogo/lip-sync → premium (${best.model})`;
  } else if (mode === "cheapest") {
    reasoning = `Modo Cheapest — ${best.model}`;
  }

  return buildRouteFromEntry(best, request, sceneMeta, reasoning);
}

export function routeSceneVideoGeneration({ scene, storyboard, adConfig, imagePath, options = {} }) {
  return routeGeneration({
    taskType: imagePath ? "image-to-video" : "text-to-video",
    scene,
    storyboard,
    imagePath,
    durationSeconds: storyboard?.durationSeconds || adConfig?.clipDurationSeconds,
    aspectRatio: storyboard?.aspectRatio || adConfig?.aspectRatio,
    resolution: storyboard?.resolution || adConfig?.resolution,
    optimizeForCost: adConfig?.optimizeForCost ?? options.optimizeForCost ?? true,
    generationMode: adConfig?.generationMode || options.generationMode || "auto",
    userSelectedProvider: scene?.generationProvider || adConfig?.generationProvider || "auto",
    userSelectedModel: scene?.generationModel || adConfig?.generationModel || "best_value",
    qualityTarget: scene?.sceneQualityRequirement,
    dialogueRequired: Boolean(scene?.voiceoverLine?.trim()),
    lipSyncRequired: scene?.lipSyncRequired,
    characterConsistency: scene?.sceneProductionClass === "UGC",
    productConsistency: scene?.sceneProductionClass === "PRODUCT",
  });
}
