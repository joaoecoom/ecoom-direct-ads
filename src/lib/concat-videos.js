import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { timestampSlug } from "../config.js";

const execFileAsync = promisify(execFile);

const NORMALIZE_FPS = Number.parseInt(process.env.VIDEO_NORMALIZE_FPS || "30", 10);

async function normalizeClipForConcat(inputPath, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      path.resolve(inputPath),
      "-vf",
      `fps=${NORMALIZE_FPS},format=yuv420p,setsar=1`,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-movflags",
      "+faststart",
      "-an",
      path.resolve(outputPath),
    ],
    { stdio: "pipe" },
  );
  return outputPath;
}

async function normalizeClipsForConcat(inputPaths, workDir, onProgress) {
  const normalized = [];
  for (let i = 0; i < inputPaths.length; i++) {
    onProgress?.({
      message: `A normalizar clip ${i + 1}/${inputPaths.length}…`,
      clipIndex: i + 1,
      clipTotal: inputPaths.length,
    });
    const out = path.join(workDir, `norm-${i}-${path.basename(inputPaths[i])}`);
    normalized.push(await normalizeClipForConcat(inputPaths[i], out));
  }
  return normalized;
}

async function getVideoDuration(filePath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    { encoding: "utf8" },
  );
  return Number.parseFloat(stdout.trim());
}

async function allClipsHaveAudio(inputPaths) {
  const checks = await Promise.all(
    inputPaths.map(async (p) => {
      try {
        const { stdout } = await execFileAsync(
          "ffprobe",
          [
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
            p,
          ],
          { encoding: "utf8" },
        );
        return stdout.trim().includes("audio");
      } catch {
        return false;
      }
    }),
  );
  return checks.every(Boolean);
}

function buildVideoCrossfadeFilter(inputCount, durations, d) {
  if (inputCount === 2) {
    return `[0:v][1:v]xfade=transition=fade:duration=${d}:offset=${(durations[0] - d).toFixed(3)}[vout]`;
  }

  let offset = durations[0] - d;
  let filter = `[0:v][1:v]xfade=transition=fade:duration=${d}:offset=${offset.toFixed(3)}[v01]`;
  for (let i = 2; i < inputCount; i++) {
    const prev = i === 2 ? "v01" : `v0${i - 1}`;
    const next = i === inputCount - 1 ? "vout" : `v0${i}`;
    offset += durations[i - 1] - d;
    filter += `;[${prev}][${i}:v]xfade=transition=fade:duration=${d}:offset=${offset.toFixed(3)}[${next}]`;
  }
  return filter;
}

function buildAudioCrossfadeFilter(inputCount, d) {
  const normalized = Array.from({ length: inputCount }, (_, i) => {
    return `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`;
  }).join(";");

  if (inputCount === 2) {
    return `${normalized};[a0][a1]acrossfade=d=${d}[aout]`;
  }

  let audioFilter = `${normalized};[a0][a1]acrossfade=d=${d}[a01]`;
  for (let i = 2; i < inputCount; i++) {
    const prev = i === 2 ? "a01" : `a0${i - 1}`;
    const next = i === inputCount - 1 ? "aout" : `a0${i}`;
    audioFilter += `;[${prev}][a${i}]acrossfade=d=${d}[${next}]`;
  }
  return audioFilter;
}

/**
 * Junta clips com crossfade — transição fluida (parece 1 vídeo).
 */
export async function concatenateVideosWithCrossfade(
  inputPaths,
  outputPath,
  { crossfadeSeconds = 0.6, keepAudio = false, onProgress } = {},
) {
  if (inputPaths.length === 0) {
    throw new Error("Nenhum clip para juntar.");
  }
  if (inputPaths.length === 1) {
    await fs.copyFile(inputPaths[0], outputPath);
    return outputPath;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const durations = [];
  for (const p of inputPaths) {
    durations.push(await getVideoDuration(p));
  }

  const d = Math.min(
    crossfadeSeconds,
    ...durations.map((x) => x * 0.35),
  );
  console.log(`   Crossfade: ${d.toFixed(2)}s entre ${inputPaths.length} clips`);

  const workDir = path.join(path.dirname(outputPath), `xfade-${timestampSlug()}`);
  let pathsToJoin = inputPaths;
  try {
    onProgress?.({ message: `A normalizar ${inputPaths.length} clip(s)…`, clipIndex: 0, clipTotal: inputPaths.length });
    pathsToJoin = await normalizeClipsForConcat(inputPaths, workDir, onProgress);
    durations.length = 0;
    for (const p of pathsToJoin) {
      durations.push(await getVideoDuration(p));
    }
  } catch (err) {
    console.log(`   ⚠️ Normalização de clips falhou (${err.message}) — a usar originais...\n`);
    pathsToJoin = inputPaths;
  }

  const dFinal = Math.min(crossfadeSeconds, ...durations.map((x) => x * 0.35));

  const inputs = pathsToJoin.flatMap((p) => ["-i", path.resolve(p)]);
  const videoFilter = buildVideoCrossfadeFilter(pathsToJoin.length, durations, dFinal);
  const useAudio = keepAudio && (await allClipsHaveAudio(inputPaths));

  onProgress?.({ message: `FFmpeg crossfade (${pathsToJoin.length} clips)…` });

  async function runFfmpeg(filterComplex, includeAudio) {
    const args = [
      "-y",
      ...inputs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ];

    if (includeAudio) {
      args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
    } else {
      args.push("-an");
    }

    args.push(path.resolve(outputPath));
    await execFileAsync("ffmpeg", args, { stdio: "pipe" });
  }

  if (useAudio) {
    try {
      await runFfmpeg(
        `${videoFilter};${buildAudioCrossfadeFilter(pathsToJoin.length, dFinal)}`,
        true,
      );
      return outputPath;
    } catch (err) {
      console.log(
        `   ⚠️ Crossfade com áudio falhou (${err.message}) — a usar só vídeo...\n`,
      );
    }
  }

  await runFfmpeg(videoFilter, false);
  return outputPath;
}

/**
 * Junta vários MP4 (concat simples — fallback).
 */
export async function concatenateVideos(inputPaths, outputPath, options = {}) {
  const crossfade =
    options.crossfadeSeconds ??
    Number.parseFloat(process.env.VIDEO_CROSSFADE_SECONDS || "0");
  const onProgress = options.onProgress;

  if (crossfade > 0 && inputPaths.length > 1) {
    try {
      return await concatenateVideosWithCrossfade(inputPaths, outputPath, {
        crossfadeSeconds: crossfade,
        keepAudio: options.keepAudio === true,
        onProgress,
      });
    } catch (err) {
      console.log(`   ⚠️ Crossfade falhou (${err.message}), concat simples...\n`);
    }
  }

  if (inputPaths.length === 0) throw new Error("Nenhum clip para juntar.");
  if (inputPaths.length === 1) {
    await fs.copyFile(inputPaths[0], outputPath);
    return outputPath;
  }

  const listDir = path.dirname(outputPath);
  await fs.mkdir(listDir, { recursive: true });
  const listFile = path.join(listDir, `concat-${timestampSlug()}.txt`);
  const listContent = inputPaths
    .map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`)
    .join("\n");

  await fs.writeFile(listFile, listContent);
  try {
    await execFileAsync(
      "ffmpeg",
      ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputPath],
      { stdio: "pipe" },
    );
  } catch {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: "pipe" },
    );
  } finally {
    await fs.unlink(listFile).catch(() => {});
  }
  return outputPath;
}
