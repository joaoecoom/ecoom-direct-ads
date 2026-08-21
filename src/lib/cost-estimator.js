import { getModelEntry, listModelEntries } from "./providers/model-registry.js";
import { getProvider } from "./providers/generation-provider.js";

/**
 * Cost estimation before generation. Values marked costUnknown are heuristics, not invoices.
 */

export function estimateRouteCost(route) {
  const provider = getProvider(route.provider);
  if (!provider) {
    return {
      estimatedCostUsd: null,
      estimatedGpuTimeMs: null,
      costUnknown: true,
      costType: "unknown",
      provider: route.provider,
      model: route.model,
      qualityTier: route.qualityTier || "open",
      note: "Provider desconhecido",
    };
  }
  return provider.estimateCost({}, route.modelId);
}

export function estimateGenerationPlan(routes) {
  let estimatedTotalUsd = 0;
  let hasUnknown = false;
  let totalGpuMs = 0;

  const items = routes.map((route) => {
    const est = estimateRouteCost(route);
    if (est.costUnknown || est.estimatedCostUsd == null) hasUnknown = true;
    else estimatedTotalUsd += est.estimatedCostUsd;
    if (est.estimatedGpuTimeMs) totalGpuMs += est.estimatedGpuTimeMs;
    return { ...route, estimate: est };
  });

  return {
    items,
    estimatedTotalUsd: hasUnknown ? null : estimatedTotalUsd,
    estimatedTotalGpuMs: totalGpuMs || null,
    costUnknown: hasUnknown,
    summary: hasUnknown ? "COST UNKNOWN (parcial)" : `$${estimatedTotalUsd.toFixed(4)} estimado`,
  };
}

export function formatCostDisplay(estimate) {
  if (!estimate) return "COST UNKNOWN";
  if (estimate.costUnknown || estimate.estimatedCostUsd == null) return "COST UNKNOWN";
  return `$${estimate.estimatedCostUsd.toFixed(4)}`;
}

export function formatGpuTime(ms) {
  if (!ms) return "—";
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function aggregateActualCosts(generations = []) {
  const byProvider = {};
  const byModel = {};
  let actualTotal = 0;
  let hasUnknown = false;

  for (const g of generations) {
    const cost = g.actualCostUsd;
    if (cost == null) {
      hasUnknown = true;
      continue;
    }
    actualTotal += cost;
    byProvider[g.provider] = (byProvider[g.provider] || 0) + cost;
    byModel[g.model] = (byModel[g.model] || 0) + cost;
  }

  return {
    actualTotalUsd: hasUnknown && generations.length ? null : actualTotal,
    costUnknown: hasUnknown,
    byProvider,
    byModel,
  };
}
