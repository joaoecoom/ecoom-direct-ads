import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { timestampSlug } from "../config.js";

const execFileAsync = promisify(execFile);

/**
 * Junta clips de áudio num ficheiro (concat demuxer).
 */
export async function concatenateAudio(inputPaths, outputPath) {
  if (inputPaths.length === 0) {
    throw new Error("Nenhum áudio para juntar.");
  }
  if (inputPaths.length === 1) {
    await fs.copyFile(inputPaths[0], outputPath);
    return outputPath;
  }

  const listDir = path.dirname(outputPath);
  await fs.mkdir(listDir, { recursive: true });
  const listFile = path.join(listDir, `audio-concat-${timestampSlug()}.txt`);
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
  } finally {
    await fs.unlink(listFile).catch(() => {});
  }
  return outputPath;
}

/**
 * Mixa áudio sobre vídeo (substitui áudio original do Veo).
 */
export async function mixAudioOnVideo({ videoPath, audioPath, outputPath }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { stdio: "pipe" },
  );

  return outputPath;
}

/**
 * Por cena: vídeo Veo + áudio TTS → clip com voz PT-PT.
 */
export async function mixSceneClipsWithVoice(scenes, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const mixed = [];

  for (const scene of scenes) {
    const out = path.join(outputDir, `${scene.id}-voiced.mp4`);
    console.log(`🔊 A mixar voz na cena ${scene.id}...`);
    await mixAudioOnVideo({
      videoPath: scene.videoPath,
      audioPath: scene.audioPath,
      outputPath: out,
    });
    mixed.push(out);
    console.log(`   ✅ ${out}\n`);
  }

  return mixed;
}
