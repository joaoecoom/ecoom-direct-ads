import { randomUUID } from "node:crypto";
import { initProviders } from "./providers/index.js";
import { ensureProvider } from "./providers/generation-provider.js";
import { routeSceneVideoGeneration, routeGeneration } from "./model-router.js";
import { estimateRouteCost, estimateGenerationPlan } from "./cost-estimator.js";
import { enrichStoryboardProductionMeta } from "./scene-classification.js";

initProviders();

/**
 * Unified generation orchestration — does NOT bypass user approval for paid ops.
 */

export function buildGenerationPlan({ scenes = [], storyboard, adConfig, options = {} }) {
  const enriched = enrichStoryboardProductionMeta(storyboard || { scenes });
  const sceneList = scenes.length ? scenes : enriched.scenes || [];

  const routes = sceneList.map((scene) =>
    routeSceneVideoGeneration({
      scene,
      storyboard: enriched,
      adConfig: adConfig || {},
      imagePath: scene.imageAssetId ? "pending" : null,
      options,
    }),
  );

  return {
    planId: randomUUID(),
    scenes: sceneList.map((scene, i) => ({
      sceneId: scene.id,
      sceneProductionClass: routes[i].sceneProductionClass,
      sceneQualityRequirement: routes[i].sceneQualityRequirement,
      route: routes[i],
      estimate: estimateRouteCost(routes[i]),
    })),
    ...estimateGenerationPlan(routes),
    requiresApproval: true,
    status: "IMPLEMENTED",
  };
}

export function assertGenerationApproved(request, route) {
  if (request.approved === true || request.generationApproved === true) return;

  const est = estimateRouteCost(route);
  const hasCost = !est.costUnknown && est.estimatedCostUsd != null && est.estimatedCostUsd > 0;
  const paidProvider = route.provider === "floyo" || route.provider === "kie";

  if (hasCost || paidProvider) {
    const err = new Error(
      "Aprovação necessária antes de gerar — revê o plano de custo e confirma GENERATE",
    );
    err.code = "APPROVAL_REQUIRED";
    err.route = route;
    err.estimate = est;
    throw err;
  }
}

export async function executeRoutedVideoGeneration({
  request,
  route,
  fallbackOnFailure = false,
  onFallbackConfirm,
}) {
  assertGenerationApproved(request, route);

  const provider = ensureProvider(route.provider);
  let result = await provider.generateVideo(
    {
      ...request,
      approved: true,
    },
    route.modelId,
  );

  if (!result.ok && fallbackOnFailure && route.fallbackModelId) {
    const fallbackRoute = routeGeneration({
      ...request,
      userSelectedModel: route.fallbackModelId,
      approved: false,
    });
    const fallbackEst = estimateRouteCost(fallbackRoute);

    if (onFallbackConfirm) {
      const allowed = await onFallbackConfirm({ originalError: result.error, fallbackRoute, fallbackEst });
      if (!allowed) return result;
    }

    assertGenerationApproved({ ...request, approved: true }, fallbackRoute);
    const fallbackProvider = ensureProvider(fallbackRoute.provider);
    result = await fallbackProvider.generateVideo({ ...request, approved: true }, fallbackRoute.modelId);
    result.metadata = { ...(result.metadata || {}), fallbackFrom: route.modelId, fallbackRoute };
  }

  return {
    ...result,
    generationId: randomUUID(),
    lineage: {
      parentAssetId: request.parentAssetId || null,
      originalAssetId: request.originalAssetId || request.parentAssetId || null,
      provider: result.provider,
      model: result.model,
      workflowId: route.workflowId || result.workflowId || null,
    },
  };
}

export async function generateSceneVideoRouted({
  storyboard,
  adConfig,
  scene,
  sceneIndex,
  imagePath,
  lastFramePath,
  outputFileName,
  runLabel,
  motionPromptOverride,
  prompt,
  approved = false,
  generationMode,
  optimizeForCost,
  onFallbackConfirm,
}) {
  const route = routeSceneVideoGeneration({
    scene,
    storyboard,
    adConfig,
    imagePath,
    options: { generationMode, optimizeForCost },
  });

  const request = {
    taskType: imagePath ? "image-to-video" : "text-to-video",
    prompt: prompt || motionPromptOverride || scene.motionPrompt || scene.visualBeat || "",
    imagePath,
    lastFramePath,
    durationSeconds: storyboard?.durationSeconds || adConfig?.clipDurationSeconds,
    aspectRatio: storyboard?.aspectRatio || adConfig?.aspectRatio,
    resolution: storyboard?.resolution || adConfig?.resolution,
    outputFileName,
    runLabel,
    scene,
    storyboard,
    approved,
    generationApproved: approved,
    optimizeForCost: optimizeForCost ?? adConfig?.optimizeForCost ?? true,
    generationMode: generationMode || adConfig?.generationMode || "auto",
  };

  const result = await executeRoutedVideoGeneration({
    request,
    route,
    fallbackOnFailure: true,
    onFallbackConfirm,
  });

  return {
    sceneId: scene.id || `parte-${sceneIndex + 1}`,
    path: result.localPath,
    prompt: request.prompt,
    order: sceneIndex,
    route,
    generation: result,
  };
}

export async function getProviderDiagnostics() {
  initProviders();
  const { listProviders } = await import("./providers/generation-provider.js");
  const { getConfiguredModels } = await import("./providers/model-registry.js");

  const providers = await Promise.all(listProviders().map((p) => p.healthCheck()));
  const models = getConfiguredModels();

  return {
    providers,
    models,
    status: "IMPLEMENTED",
    tested: false,
  };
}
