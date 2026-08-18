import { randomUUID } from "node:crypto";

export function emptyCreative({ title, index = 1 } = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: title || `Vídeo ${index}`,
    createdAt: now,
    updatedAt: now,
    copy: null,
    blueprintPath: null,
    blueprint: null,
    scenes: [],
    latestExport: null,
    timelineStatus: "pending",
    jobIds: [],
  };
}

export function migrateCreatives(raw) {
  if (raw.creatives?.some((c) => Array.isArray(c.scenes))) {
    return raw.creatives.map((c) => ({
      jobIds: [],
      timelineStatus: "pending",
      ...c,
      scenes: c.scenes || [],
    }));
  }

  if (raw.scenes?.length || raw.blueprintPath || raw.latestExport) {
    const legacy = emptyCreative({
      title: raw.blueprint?.title || raw.latestCreative?.title || "Vídeo 1",
      index: 1,
    });
    legacy.scenes = raw.scenes || [];
    legacy.blueprintPath = raw.blueprintPath || null;
    legacy.blueprint = raw.blueprint || null;
    legacy.latestExport = raw.latestExport || null;
    legacy.timelineStatus = raw.timelineStatus || "pending";
    legacy.copy = raw.latestCopy || null;
    legacy.jobIds = raw.jobIds || [];
    return [legacy];
  }

  return [];
}

export function resolveCreative(project, creativeId = null) {
  if (!project) return null;
  const id = creativeId || project.activeCreativeId;
  if (!id) return project.creatives?.[0] || null;
  return project.creatives?.find((c) => c.id === id) || project.creatives?.[0] || null;
}

export function mirrorProjectFromCreative(project) {
  const active = resolveCreative(project);
  return {
    ...project,
    activeCreative: active,
    activeCreativeId: active?.id || project.activeCreativeId || null,
    scenes: active?.scenes || [],
    blueprintPath: active?.blueprintPath || null,
    blueprint: active?.blueprint || null,
    latestExport: active?.latestExport || null,
    latestCopy: active?.copy || null,
    timelineStatus: active?.timelineStatus || "pending",
  };
}

export function listCreativeSummaries(project, assetById = {}) {
  return (project.creatives || []).map((c) => {
    const exportAsset = c.latestExport?.assetId ? assetById[c.latestExport.assetId] : null;
    const firstScene = c.scenes?.find((s) => s.imageAssetId);
    const thumbAsset = firstScene?.imageAssetId ? assetById[firstScene.imageAssetId] : exportAsset;
    const clipsReady = (c.scenes || []).filter((s) => s.videoAssetId).length;
    return {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      sceneCount: c.scenes?.length || 0,
      clipsReady,
      hasExport: Boolean(c.latestExport?.assetId),
      timelineStatus: c.timelineStatus || "pending",
      thumbAssetId: thumbAsset?.id || null,
      isActive: c.id === project.activeCreativeId,
    };
  });
}
