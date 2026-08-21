import { routeGeneration } from "./model-router.js";
import { estimateRouteCost } from "./cost-estimator.js";

/**
 * Sugere B-roll a partir do transcript UGC.
 * Heurística — não gera automaticamente sem aprovação.
 */

const VISUAL_TRIGGERS = [
  { pattern: /sérum|serum|creme|cream|produto|product/i, visual: "Macro shot of product texture and application on skin", class: "PRODUCT" },
  { pattern: /pele|skin|manchas|spots|wrinkle|rugas/i, visual: "Close-up skin detail, soft natural lighting, before/after implication", class: "PRODUCT" },
  { pattern: /resultado|results|antes|depois|before|after/i, visual: "Split-style lifestyle result shot, same lighting as UGC base", class: "BROLL" },
  { pattern: /rotina|routine|manhã|morning|noite|night/i, visual: "Hands applying product in bathroom/kitchen routine, cinematic shallow DOF", class: "BROLL" },
  { pattern: /ingredient|componente|formula/i, visual: "Ingredient flat lay or liquid pour macro", class: "PRODUCT" },
];

function estimateSegmentTimes(transcript, totalSeconds = 30) {
  const sentences = transcript
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return [];

  const perSentence = totalSeconds / sentences.length;
  let t = 0;
  return sentences.map((text, i) => {
    const start = t;
    const end = Math.min(totalSeconds, t + perSentence);
    t = end;
    return { index: i, text, startTime: start, endTime: end, duration: end - start };
  });
}

export function suggestBrollFromTranscript({
  transcript = "",
  totalSeconds = 30,
  productContext = "",
  creativeBrief = "",
  optimizeForCost = true,
} = {}) {
  const segments = estimateSegmentTimes(transcript, totalSeconds);
  const suggestions = [];

  for (const seg of segments) {
    let matched = null;
    for (const trig of VISUAL_TRIGGERS) {
      if (trig.pattern.test(seg.text)) {
        matched = trig;
        break;
      }
    }
    if (!matched) continue;

    const visualDescription = `${matched.visual}. Context: ${productContext || creativeBrief || "UGC ad"}.`;
    const route = routeGeneration({
      taskType: "image-to-video",
      optimizeForCost,
      scene: {
        sceneType: "broll",
        sceneProductionClass: matched.class,
        sceneQualityRequirement: "MEDIUM",
        visualBeat: visualDescription,
      },
    });
    const estimate = estimateRouteCost(route);

    suggestions.push({
      startTime: seg.startTime,
      endTime: seg.endTime,
      voiceText: seg.text,
      visualDescription,
      reason: `Frase visualizável detectada (${matched.class})`,
      recommendedProvider: route.provider,
      recommendedModel: route.model,
      recommendedModelId: route.modelId,
      estimatedCost: estimate,
      route,
    });
  }

  return suggestions;
}

export function buildBrollTimelineOverlay({ ugcVideoAssetId, voiceAssetId, suggestions = [] }) {
  return {
    baseUgcVideoAssetId: ugcVideoAssetId,
    voiceAssetId,
    voiceContinuityId: voiceAssetId,
    segments: suggestions.map((s, i) => ({
      id: `broll-${i + 1}`,
      startTime: s.startTime,
      endTime: s.endTime,
      visualDescription: s.visualDescription,
      status: "suggested",
      locked: false,
      provider: s.recommendedProvider,
      model: s.recommendedModel,
      videoAssetId: null,
    })),
  };
}
