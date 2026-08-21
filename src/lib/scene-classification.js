/**
 * Scene production classification for ModelRouter.
 * Values are heuristics — not official benchmarks.
 */

export const SCENE_PRODUCTION_CLASSES = [
  "UGC",
  "BROLL",
  "PRODUCT",
  "HERO",
  "BACKGROUND",
  "FOOD",
  "SCREEN",
  "MOTION_GRAPHIC",
  "TESTIMONIAL",
  "TRANSITION",
  "OTHER",
];

export const SCENE_QUALITY_LEVELS = ["LOW", "MEDIUM", "HIGH", "PREMIUM"];

const SCENE_TYPE_MAP = {
  ugc: "UGC",
  broll: "BROLL",
  react_overlay: "UGC",
};

export function inferProductionClass(scene = {}, storyboard = {}) {
  if (scene.sceneProductionClass) return scene.sceneProductionClass;

  const st = (scene.sceneType || "").toLowerCase();
  if (SCENE_TYPE_MAP[st]) return SCENE_TYPE_MAP[st];

  const role = `${scene.role || ""} ${scene.visualBeat || ""}`.toLowerCase();
  if (/product|produto|serum|bottle|pack/i.test(role)) return "PRODUCT";
  if (/hero|opening|hook/i.test(role)) return "HERO";
  if (/background|ambiente|establishing/i.test(role)) return "BACKGROUND";
  if (/food|comida|prato/i.test(role)) return "FOOD";
  if (/screen|overlay|phone|ui/i.test(role)) return "SCREEN";
  if (/testimonial|review|depoimento/i.test(role)) return "TESTIMONIAL";
  if (/transition|cutaway/i.test(role)) return "TRANSITION";

  if (storyboard?.config?.videoFormat === "ugc_broll" && st === "broll") return "BROLL";
  return "OTHER";
}

export function inferQualityRequirement(scene = {}, productionClass = "OTHER") {
  if (scene.sceneQualityRequirement) return scene.sceneQualityRequirement;

  const dialogue = Boolean(scene.voiceoverLine?.trim());
  const lipSync = scene.lipSyncRequired === true;
  const importance = (scene.sceneImportance || "").toLowerCase();

  if (lipSync || (productionClass === "UGC" && dialogue)) return "PREMIUM";
  if (productionClass === "HERO" || importance === "critical") return "PREMIUM";
  if (productionClass === "TESTIMONIAL" && dialogue) return "PREMIUM";
  if (["BROLL", "BACKGROUND", "TRANSITION"].includes(productionClass)) return "MEDIUM";
  if (productionClass === "PRODUCT") return "HIGH";
  return "HIGH";
}

export function enrichSceneProductionMeta(scene, storyboard = {}) {
  const sceneProductionClass = inferProductionClass(scene, storyboard);
  const sceneQualityRequirement = inferQualityRequirement(scene, sceneProductionClass);
  return {
    ...scene,
    sceneProductionClass,
    sceneQualityRequirement,
    dialogueRequired: Boolean(scene.voiceoverLine?.trim()) && sceneProductionClass === "UGC",
    lipSyncRequired: scene.lipSyncRequired ?? (sceneProductionClass === "UGC" && Boolean(scene.voiceoverLine?.trim())),
    audioRequired: Boolean(scene.voiceoverLine?.trim()),
  };
}

export function enrichStoryboardProductionMeta(storyboard) {
  const scenes = (storyboard.scenes || []).map((s) => enrichSceneProductionMeta(s, storyboard));
  return { ...storyboard, scenes };
}
