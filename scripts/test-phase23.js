#!/usr/bin/env node
/**
 * Phase 23 validation harness — does NOT claim production-ready.
 * Run individual tests; reports IMPLEMENTED / NOT TESTED / API LIMITED.
 */
import "dotenv/config";
import { initProviders } from "../src/lib/providers/index.js";
import { getProviderDiagnostics } from "../src/lib/generation-service.js";
import { routeGeneration } from "../src/lib/model-router.js";
import { estimateRouteCost } from "../src/lib/cost-estimator.js";
import { suggestBrollFromTranscript } from "../src/lib/broll-engine.js";
import { isFloyoConfigured } from "../src/lib/providers/floyo-client.js";

const test = process.argv[2] || "diagnostics";

async function runDiagnostics() {
  const d = await getProviderDiagnostics();
  console.log(JSON.stringify(d, null, 2));
  return d;
}

async function runRouterTests() {
  const cases = [
    { label: "B-roll", scene: { sceneType: "broll", visualBeat: "product macro" } },
    { label: "UGC dialogue", scene: { sceneType: "ugc", voiceoverLine: "Olá, hoje falo-vos deste sérum." } },
    { label: "Hero", scene: { sceneProductionClass: "HERO", sceneImportance: "critical" } },
  ];
  for (const c of cases) {
    const route = routeGeneration({
      taskType: "image-to-video",
      scene: c.scene,
      optimizeForCost: true,
    });
    const est = estimateRouteCost(route);
    console.log(`\n[${c.label}]`);
    console.log(`  Provider: ${route.provider} / ${route.model}`);
    console.log(`  Reason: ${route.reasoning}`);
    console.log(`  Cost: ${est.costUnknown ? "COST UNKNOWN" : est.estimatedCostUsd}`);
    console.log(`  Fallback: ${route.fallbackProvider}/${route.fallbackModel}`);
  }
}

async function runBrollTest() {
  const suggestions = suggestBrollFromTranscript({
    transcript:
      "Este sérum reduz visivelmente a aparência das manchas. A minha rotina de manhã ficou muito mais simples.",
    totalSeconds: 20,
  });
  console.log(JSON.stringify(suggestions, null, 2));
}

async function runFloyoHealth() {
  initProviders();
  if (!isFloyoConfigured()) {
    console.log("STATUS: API LIMITED — FLOYO_API_KEY not set");
    return;
  }
  const d = await runDiagnostics();
  const floyo = d.providers.find((p) => p.id === "floyo");
  console.log("\nFloyo:", floyo?.status, floyo?.message || "");
  console.log("Configured workflows:", d.models.filter((m) => m.providerId === "floyo" && m.configured).length);
}

const runners = {
  diagnostics: runDiagnostics,
  router: runRouterTests,
  broll: runBrollTest,
  floyo: runFloyoHealth,
};

const fn = runners[test];
if (!fn) {
  console.error(`Unknown test: ${test}. Use: ${Object.keys(runners).join(", ")}`);
  process.exit(1);
}

fn().catch((err) => {
  console.error("TEST ERROR:", err.message);
  process.exit(1);
});
