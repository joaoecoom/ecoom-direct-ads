import path from "node:path";
import { concatenateVideos } from "./concat-videos.js";
import { ensureOutputDir } from "../config.js";

/**
 * Rebuild final MP4 from clips existentes — só ffmpeg, sem Veo.
 */
export async function rebuildTimelineVideo({
  clipPaths,
  outputPath,
  storyboard,
  onProgress,
}) {
  if (!clipPaths.length) {
    throw new Error("Nenhum clip de vídeo para juntar.");
  }

  const isUgc = storyboard?.style === "ugc";
  const crossfadeSeconds = isUgc && clipPaths.length > 1 ? 0.35 : 0;
  const keepAudio = process.env.VEO_GENERATE_AUDIO !== "false";

  onProgress?.({
    step: "rebuild",
    message: `A juntar ${clipPaths.length} clip(s) com ffmpeg...`,
  });

  await ensureOutputDir(path.dirname(outputPath));

  await concatenateVideos(clipPaths, outputPath, {
    crossfadeSeconds,
    keepAudio,
  });

  return {
    finalVideo: outputPath,
    clipCount: clipPaths.length,
    crossfadeSeconds,
  };
}

export function estimateTimelineDuration(scenes, clipDurationSeconds = 8, crossfadeSeconds = 0) {
  const n = scenes.length;
  if (n === 0) return 0;
  if (n === 1) return clipDurationSeconds;
  const overlap = crossfadeSeconds * (n - 1);
  return Math.max(clipDurationSeconds, n * clipDurationSeconds - overlap);
}
