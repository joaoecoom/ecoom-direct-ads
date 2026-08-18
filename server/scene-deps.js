/** Dependency states when scene assets change */

export function normalizeSceneStatus(scene, projectHasExport = false) {
  const base = {
    prompt: scene.status?.prompt || "done",
    image: scene.status?.image || "pending",
    video: scene.status?.video || "pending",
    final: scene.status?.final || (projectHasExport ? "pending" : "pending"),
  };
  return base;
}

export function statusAfterImageChange(scene, projectHasExport) {
  const hadVideo = Boolean(scene.videoAssetId);
  const imageChanged = true;
  return {
    ...scene.status,
    prompt: "done",
    image: "done",
    video: hadVideo ? "outdated" : scene.status?.video || "pending",
    final: projectHasExport ? "outdated" : scene.status?.final || "pending",
  };
}

export function statusAfterVideoChange(scene, projectHasExport) {
  return {
    ...scene.status,
    video: "done",
    final: projectHasExport ? "outdated" : scene.status?.final || "pending",
  };
}

export function statusWhileGenerating(type) {
  if (type === "image") return { image: "generating" };
  if (type === "video") return { video: "generating" };
  return {};
}

export function sceneNeedsVideoRegen(scene) {
  return scene.status?.video === "outdated";
}

export function statusAfterMotionPromptChange(scene, projectHasExport) {
  const hadVideo = Boolean(scene.videoAssetId);
  return {
    ...scene.status,
    prompt: "done",
    video: hadVideo ? "outdated" : scene.status?.video || "pending",
    final: projectHasExport ? "outdated" : scene.status?.final || "pending",
  };
}

export function sceneNeedsFinalRebuild(scene, projectHasExport) {
  return (
    projectHasExport &&
    (scene.status?.final === "outdated" || scene.status?.video === "outdated")
  );
}
