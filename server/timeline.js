import { getAsset, resolveAssetFile } from "./asset-store.js";
import { estimateTimelineDuration } from "../src/lib/timeline-rebuild.js";
import { sceneNeedsFinalRebuild } from "./scene-deps.js";

function sceneBlockStatus(scene) {
  const st = scene.status || {};
  return {
    prompt: st.prompt || "done",
    image: st.image || "pending",
    video: st.video || "pending",
    final: st.final || "pending",
  };
}

export function buildTimelineView(project) {
  const scenes = [...(project.scenes || [])].sort((a, b) => a.order - b.order);
  const clipDuration = project.settings?.clipDurationSeconds || 8;
  const isUgc = project.settings?.style === "ugc";
  const crossfadeSeconds = isUgc && scenes.length > 1 ? 0.35 : 0;
  const projectHasExport = Boolean(project.latestExport);

  const blocks = scenes.map((scene, index) => ({
    id: scene.id,
    order: scene.order ?? index,
    startSeconds: index * clipDuration,
    durationSeconds: clipDuration,
    endSeconds: (index + 1) * clipDuration,
    imageAssetId: scene.imageAssetId || null,
    videoAssetId: scene.videoAssetId || null,
    imageVersions: scene.imageVersions || [],
    videoVersions: scene.videoVersions || [],
    motionPrompt: scene.motionPrompt || "",
    imagePrompt: scene.imagePrompt || "",
    status: sceneBlockStatus(scene),
    needsVideoRegen: scene.status?.video === "outdated",
    needsFinalRebuild: sceneNeedsFinalRebuild(scene, projectHasExport),
  }));

  const videosReady = scenes.filter((s) => s.videoAssetId).length;
  const allVideosReady = scenes.length > 0 && videosReady === scenes.length;
  const hasOutdatedClips = blocks.some((b) => b.needsVideoRegen);
  const hasOutdatedFinal = blocks.some((b) => b.needsFinalRebuild);

  let timelineStatus = project.timelineStatus || "pending";
  if (!scenes.length) timelineStatus = "pending";
  else if (!allVideosReady) timelineStatus = "waiting_clips";
  else if (hasOutdatedClips || hasOutdatedFinal || !project.latestExport || timelineStatus === "needs_rebuild") {
    timelineStatus = "needs_rebuild";
  } else {
    timelineStatus = "ready";
  }

  return {
    scenes: blocks,
    sceneCount: scenes.length,
    videosReady,
    allVideosReady,
    hasOutdatedClips,
    hasOutdatedFinal,
    totalDurationSeconds: estimateTimelineDuration(scenes, clipDuration, crossfadeSeconds),
    displayDurationSeconds: scenes.length * clipDuration,
    crossfadeSeconds,
    timelineStatus,
    latestExport: project.latestExport || null,
  };
}

export async function resolveSceneVideoPath(scene) {
  if (!scene?.videoAssetId) {
    throw new Error(`Cena ${scene.id} sem clip de vídeo.`);
  }
  const asset = await getAsset(scene.videoAssetId);
  if (!asset) throw new Error(`Asset vídeo ${scene.videoAssetId} não encontrado.`);
  return resolveAssetFile(asset);
}
