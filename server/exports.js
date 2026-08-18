import { getJob } from "./job-store.js";
import { buildTimelineView } from "./timeline.js";

export async function buildExportView(project, assets = []) {
  const timeline = buildTimelineView(project);

  const exportAssets = assets
    .filter((a) => a.type === "video" && (a.source === "export" || a.metadata?.export))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  let copy = null;
  const copyJobId = project.latestExport?.jobId || project.latestCreative?.jobId;
  if (copyJobId) {
    const job = await getJob(copyJobId);
    copy = job?.result?.copy || null;
  }

  const latest = project.latestExport || null;
  const latestAsset = latest?.assetId
    ? exportAssets.find((a) => a.id === latest.assetId)
    : exportAssets[0];

  const exportStatus =
    timeline.timelineStatus === "ready"
      ? "ready"
      : timeline.allVideosReady && (timeline.hasOutdatedClips || timeline.hasOutdatedFinal)
        ? "outdated"
        : timeline.allVideosReady
          ? "needs_rebuild"
          : "waiting";

  return {
    exportStatus,
    timelineStatus: timeline.timelineStatus,
    allVideosReady: timeline.allVideosReady,
    hasOutdatedClips: timeline.hasOutdatedClips,
    hasOutdatedFinal: timeline.hasOutdatedFinal,
    sceneCount: timeline.sceneCount,
    videosReady: timeline.videosReady,
    totalDurationSeconds: timeline.totalDurationSeconds,
    displayDurationSeconds: timeline.displayDurationSeconds,
    crossfadeSeconds: timeline.crossfadeSeconds,
    latestExport: latest
      ? {
          assetId: latest.assetId,
          jobId: latest.jobId,
          rebuiltAt: latest.rebuiltAt,
          clipCount: latestAsset?.metadata?.clipCount || timeline.sceneCount,
        }
      : null,
    history: exportAssets.map((a) => ({
      assetId: a.id,
      jobId: a.metadata?.jobId || null,
      createdAt: a.createdAt,
      clipCount: a.metadata?.clipCount || null,
      active: a.id === latest?.assetId,
    })),
    copy,
    blueprint: project.blueprint || null,
  };
}
