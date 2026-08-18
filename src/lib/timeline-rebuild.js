import fs from "node:fs/promises";
import path from "node:path";
import { concatenateVideos } from "./concat-videos.js";
import { ensureOutputDir } from "../config.js";
import { generateSceneVoiceovers } from "./tts.js";
import { mixSceneClipsWithVoice } from "./mix-audio.js";
import { isLipSyncAvailable, lipSyncSceneClips } from "./lipsync.js";
import {
  resolveCrossfadeSeconds,
  resolveVoicePipeline,
  shouldUseUgcFlow,
} from "./ugc-flow.js";

/**
 * Rebuild final MP4 from clips existentes — ffmpeg + voz PT-PT (como full_ad no Cursor).
 */
export async function rebuildTimelineVideo({
  clipPaths,
  sceneIds = [],
  outputPath,
  storyboard,
  adConfig = {},
  onProgress,
}) {
  if (!clipPaths.length) {
    throw new Error("Nenhum clip de vídeo para juntar.");
  }

  const veoFlow = shouldUseUgcFlow(storyboard, adConfig, clipPaths.length);
  const crossfadeSeconds = resolveCrossfadeSeconds(
    storyboard,
    adConfig,
    clipPaths.length,
    { veoFlow },
  );
  const { useExternalTts, useVeoNativeAudio } = resolveVoicePipeline(
    adConfig,
    storyboard,
    adConfig,
  );

  onProgress?.({
    step: "rebuild",
    message:
      crossfadeSeconds > 0
        ? `A juntar ${clipPaths.length} clip(s) com crossfade ${crossfadeSeconds}s...`
        : `A juntar ${clipPaths.length} clip(s)...`,
  });

  await ensureOutputDir(path.dirname(outputPath));

  const workDir = path.dirname(outputPath);
  const silentPath = path.join(workDir, `silent-${path.basename(outputPath)}`);

  // Crossfade só no vídeo — áudio Veo quebra o acrossfade; voz PT-PT vem depois.
  await concatenateVideos(clipPaths, silentPath, {
    crossfadeSeconds,
    keepAudio: false,
  });

  let finalVideo = silentPath;

  if (useExternalTts && storyboard?.scenes?.length) {
    onProgress?.({ step: "voice", message: "A gerar voz PT-PT..." });

    const runId = path.basename(outputPath, ".mp4");
    const audioDir = path.join(workDir, `audio-${runId}`);
    const voiceParts = await generateSceneVoiceovers(storyboard.scenes, audioDir, {
      languageVariant: adConfig.languageVariant,
    });

    const sceneClips = storyboard.scenes.map((scene, idx) => ({
      id: scene.id || sceneIds[idx] || `parte-${idx + 1}`,
      videoPath: clipPaths[idx],
      audioPath: voiceParts.find((v) => v.id === scene.id)?.audioPath,
    }));

    for (const s of sceneClips) {
      if (!s.audioPath) {
        throw new Error(`Áudio em falta para cena ${s.id}`);
      }
    }

    let voicedClips;
    if (isLipSyncAvailable()) {
      onProgress?.({ step: "lipsync", message: "Lip sync Sync Labs..." });
      voicedClips = await lipSyncSceneClips(
        sceneClips,
        path.join(workDir, `synced-${runId}`),
      );
    } else {
      onProgress?.({ step: "mix", message: "A mixar áudio (sem lip sync)..." });
      voicedClips = await mixSceneClipsWithVoice(
        sceneClips,
        path.join(workDir, `voiced-${runId}`),
      );
    }

    onProgress?.({
      step: "rebuild",
      message: "A juntar clips com voz (crossfade)...",
    });

    await concatenateVideos(voicedClips, outputPath, {
      crossfadeSeconds,
      keepAudio: true,
    });
    finalVideo = outputPath;
  } else if (useVeoNativeAudio) {
    onProgress?.({
      step: "rebuild",
      message: "A juntar clips com áudio nativo Veo...",
    });
    await concatenateVideos(clipPaths, outputPath, {
      crossfadeSeconds,
      keepAudio: true,
    });
    finalVideo = outputPath;
  } else {
    await fsRenameOrCopy(silentPath, outputPath);
    finalVideo = outputPath;
  }

  return {
    finalVideo,
    clipCount: clipPaths.length,
    crossfadeSeconds,
    veoFlow,
    voiceApplied: useExternalTts,
  };
}

async function fsRenameOrCopy(from, to) {
  try {
    await fs.rename(from, to);
  } catch {
    await fs.copyFile(from, to);
    await fs.unlink(from).catch(() => {});
  }
}

export function estimateTimelineDuration(scenes, clipDurationSeconds = 8, crossfadeSeconds = 0) {
  const n = scenes.length;
  if (n === 0) return 0;
  if (n === 1) return clipDurationSeconds;
  const overlap = crossfadeSeconds * (n - 1);
  return Math.max(clipDurationSeconds, n * clipDurationSeconds - overlap);
}
