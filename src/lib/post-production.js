import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { timestampSlug } from "../config.js";

const execFileAsync = promisify(execFile);

function resolvePostSettings(storyboard, adConfig = {}) {
  const pp = storyboard?.postProduction || {};
  return {
    captions: pp.captions ?? adConfig.captions ?? "none",
    captionStyle: pp.captionStyle ?? pp.captions ?? adConfig.captions ?? "none",
    backgroundMusic: pp.backgroundMusic ?? adConfig.backgroundMusic ?? "none",
    editSfx: pp.editSfx ?? adConfig.editSfx ?? "none",
  };
}

export function needsPostProduction(storyboard, adConfig = {}) {
  const s = resolvePostSettings(storyboard, adConfig);
  return s.captions !== "none" || s.backgroundMusic !== "none" || s.editSfx !== "none";
}

/** Timestamps de início de cada clip (com overlap de crossfade). */
export function sceneStartTimes(sceneCount, clipDurationSeconds, crossfadeSeconds) {
  if (sceneCount <= 0) return [];
  const times = [0];
  const step = Math.max(0.5, clipDurationSeconds - crossfadeSeconds);
  for (let i = 1; i < sceneCount; i++) {
    times.push(times[i - 1] + step);
  }
  return times;
}

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function captionTextForScene(scene) {
  const text = (scene.onScreenText || scene.voiceoverLine || scene.role || "").trim();
  return text.replace(/\s+/g, " ").slice(0, 120);
}

export function buildCaptionSrt(storyboard, { clipDurationSeconds = 8, crossfadeSeconds = 0.4 } = {}) {
  const scenes = storyboard?.scenes || [];
  if (!scenes.length) return "";

  const starts = sceneStartTimes(scenes.length, clipDurationSeconds, crossfadeSeconds);
  const blocks = [];

  for (let i = 0; i < scenes.length; i++) {
    const text = captionTextForScene(scenes[i]);
    if (!text) continue;
    const start = starts[i];
    const end = start + clipDurationSeconds - 0.05;
    blocks.push(`${blocks.length + 1}\n${formatSrtTime(start)} --> ${formatSrtTime(end)}\n${text}\n`);
  }

  return blocks.join("\n");
}

function assStyleForCaptionStyle(style) {
  switch (style) {
    case "hormozi":
      return {
        name: "Hormozi",
        font: "Arial Black",
        size: 54,
        primary: "&H0000FFFF",
        outline: 4,
        alignment: 2,
        marginV: 55,
      };
    case "subtitle_clean":
      return {
        name: "Clean",
        font: "Arial",
        size: 42,
        primary: "&H00FFFFFF",
        outline: 2,
        alignment: 2,
        marginV: 45,
        back: "&H80000000",
      };
    case "emoji_pop":
      return {
        name: "EmojiPop",
        font: "Arial Black",
        size: 50,
        primary: "&H00FFFFFF",
        outline: 3,
        alignment: 2,
        marginV: 50,
      };
    case "tiktok_bold":
    default:
      return {
        name: "TikTok",
        font: "Arial Black",
        size: 52,
        primary: "&H00FFFFFF",
        outline: 4,
        alignment: 2,
        marginV: 48,
      };
  }
}

export function buildCaptionAss(storyboard, { clipDurationSeconds = 8, crossfadeSeconds = 0.4, style = "tiktok_bold" } = {}) {
  const scenes = storyboard?.scenes || [];
  const starts = sceneStartTimes(scenes.length, clipDurationSeconds, crossfadeSeconds);
  const st = assStyleForCaptionStyle(style);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: ${st.name},${st.font},${st.size},${st.primary},&H000000FF,&H00000000,${st.back || "&H00000000"},-1,0,0,0,100,100,0,0,1,${st.outline},1,${st.alignment},20,20,${st.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = [];
  for (let i = 0; i < scenes.length; i++) {
    let text = captionTextForScene(scenes[i]);
    if (!text) continue;
    if (style === "emoji_pop" && i === 0) text = `🔥 ${text}`;
    if (style === "hormozi") {
      const words = text.split(" ");
      if (words.length > 2) {
        const mid = Math.floor(words.length / 2);
        text = `${words.slice(0, mid).join(" ")} {\\c&H00FFFF&}${words.slice(mid).join(" ")}`;
      }
    }
    const start = formatAssTime(starts[i]);
    const end = formatAssTime(starts[i] + clipDurationSeconds - 0.05);
    lines.push(`Dialogue: 0,${start},${end},${st.name},,0,0,0,,${text.replace(/\n/g, "\\N")}`);
  }

  return header + lines.join("\n") + "\n";
}

function formatAssTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

async function getVideoDuration(filePath) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    { encoding: "utf8" },
  );
  return Number.parseFloat(stdout.trim()) || 60;
}

async function runFfmpeg(args) {
  await execFileAsync("ffmpeg", ["-y", ...args], { stdio: "pipe", maxBuffer: 64 * 1024 * 1024 });
}

/** Gera SFX procedural (whoosh / pop) — sem assets externos. */
export async function generateSfxFile(sfxType, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (sfxType === "pop_zoom" || sfxType === "full_dr") {
    await runFfmpeg([
      "-f", "lavfi", "-i", "sine=frequency=880:duration=0.08",
      "-af", "volume=0.35,afade=t=out:st=0.04:d=0.04",
      outputPath,
    ]);
    return outputPath;
  }

  // whoosh default
  await runFfmpeg([
    "-f", "lavfi", "-i", "anoisesrc=d=0.35:c=pink:a=0.4",
    "-af", "highpass=f=400,lowpass=f=4000,volume=0.55,afade=t=in:st=0:d=0.05,afade=t=out:st=0.2:d=0.15",
    outputPath,
  ]);
  return outputPath;
}

/** Música ambiente procedural (lo-fi bed). */
export async function generateMusicBed(durationSeconds, outputPath, variant = "soft_bed") {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const dur = Math.min(Math.max(durationSeconds, 8), 600);
  const vol = variant === "trending_lofi" ? 0.22 : 0.14;

  await runFfmpeg([
    "-f", "lavfi", "-i", `anoisesrc=d=${dur}:c=brown:a=0.08`,
    "-f", "lavfi", "-i", `sine=frequency=220:duration=${dur}`,
    "-filter_complex",
    `[0:a][1:a]amix=inputs=2:duration=first,volume=${vol},lowpass=f=900,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, dur - 3)}:d=3`,
    "-t", String(dur),
    outputPath,
  ]);
  return outputPath;
}

export async function burnCaptions(videoPath, storyboard, options, outputPath) {
  const { captionStyle, clipDurationSeconds, crossfadeSeconds } = options;
  const workDir = path.dirname(outputPath);
  const assPath = path.join(workDir, `caps-${timestampSlug()}.ass`);
  await fs.writeFile(
    assPath,
    buildCaptionAss(storyboard, { clipDurationSeconds, crossfadeSeconds, style: captionStyle }),
    "utf8",
  );

  const subPath = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
  await runFfmpeg([
    "-i", videoPath,
    "-vf", `subtitles=${subPath}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "20",
    "-c:a", "copy",
    "-movflags", "+faststart",
    outputPath,
  ]);
  await fs.unlink(assPath).catch(() => {});
  return outputPath;
}

async function videoHasAudio(videoPath) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", videoPath],
      { encoding: "utf8" },
    );
    return stdout.trim().includes("audio");
  } catch {
    return false;
  }
}

export async function addCutSfx(videoPath, cutTimesSeconds, editSfx, outputPath, workDir) {
  if (!cutTimesSeconds.length || editSfx === "none") {
    await fs.copyFile(videoPath, outputPath);
    return outputPath;
  }

  const sfxPath = path.join(workDir, `sfx-${timestampSlug()}.wav`);
  await generateSfxFile(editSfx, sfxPath);

  const hasAudio = await videoHasAudio(videoPath);

  if (hasAudio) {
    const filters = [];
    for (let i = 0; i < cutTimesSeconds.length; i++) {
      const ms = Math.round(cutTimesSeconds[i] * 1000);
      filters.push(`[1:a]adelay=${ms}|${ms},volume=0.65[sfx${i}]`);
    }
    const sfxInputs = cutTimesSeconds.map((_, i) => `[sfx${i}]`).join("");
    filters.push(
      `[0:a]${sfxInputs}amix=inputs=${cutTimesSeconds.length + 1}:duration=first:dropout_transition=0[aout]`,
    );
    try {
      await runFfmpeg([
        "-i", videoPath,
        "-i", sfxPath,
        "-filter_complex", filters.join(";"),
        "-map", "0:v",
        "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        outputPath,
      ]);
      await fs.unlink(sfxPath).catch(() => {});
      return outputPath;
    } catch {
      /* fall through */
    }
  }

  const sfxOnly = cutTimesSeconds
    .map((t, i) => `[1:a]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)},volume=0.65[s${i}]`)
    .join(";");
  const mixLabels = cutTimesSeconds.map((_, i) => `[s${i}]`).join("");
  try {
    await runFfmpeg([
      "-i", videoPath,
      "-i", sfxPath,
      "-filter_complex", `${sfxOnly};${mixLabels}amix=inputs=${cutTimesSeconds.length}:duration=longest[aout]`,
      "-map", "0:v",
      "-map", "[aout]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-shortest",
      "-movflags", "+faststart",
      outputPath,
    ]);
  } catch {
    await fs.copyFile(videoPath, outputPath);
  }

  await fs.unlink(sfxPath).catch(() => {});
  return outputPath;
}

export async function mixBackgroundMusic(videoPath, musicPath, outputPath, volume = 0.12) {
  try {
    await runFfmpeg([
      "-i", videoPath,
      "-i", musicPath,
      "-filter_complex",
      `[1:a]volume=${volume}[bed];[0:a][bed]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
      "-map", "0:v", "-map", "[aout]",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      outputPath,
    ]);
  } catch {
    await runFfmpeg([
      "-i", videoPath,
      "-i", musicPath,
      "-filter_complex", `[1:a]volume=${volume}[bed]`,
      "-map", "0:v", "-map", "[bed]",
      "-c:v", "copy", "-c:a", "aac", "-shortest",
      "-movflags", "+faststart",
      outputPath,
    ]);
  }
  return outputPath;
}

/**
 * Pipeline pós-produção: legendas → SFX nos cortes → música de fundo.
 */
export async function applyPostProduction({
  videoPath,
  storyboard,
  adConfig = {},
  outputPath,
  clipDurationSeconds = 8,
  crossfadeSeconds = 0.4,
  onProgress,
}) {
  const settings = resolvePostSettings(storyboard, adConfig);
  if (!needsPostProduction(storyboard, adConfig)) {
    await fs.copyFile(videoPath, outputPath);
    return { outputPath, applied: [] };
  }

  const workDir = path.dirname(outputPath);
  let current = videoPath;
  const applied = [];
  const tmp = (tag) => path.join(workDir, `pp-${tag}-${timestampSlug()}.mp4`);

  if (settings.captions && settings.captions !== "none") {
    onProgress?.({ step: "post", message: `Legendas (${settings.captionStyle})…` });
    const out = tmp("caps");
    await burnCaptions(current, storyboard, {
      captionStyle: settings.captionStyle,
      clipDurationSeconds,
      crossfadeSeconds,
    }, out);
    if (current !== videoPath) await fs.unlink(current).catch(() => {});
    current = out;
    applied.push("captions");
  }

  if (settings.editSfx && settings.editSfx !== "none") {
    onProgress?.({ step: "post", message: "Efeitos nos cortes (whoosh/pop)…" });
    const scenes = storyboard?.scenes?.length || 0;
    const starts = sceneStartTimes(scenes, clipDurationSeconds, crossfadeSeconds);
    const cutTimes = starts.slice(1);
    const out = tmp("sfx");
    await addCutSfx(current, cutTimes, settings.editSfx, out, workDir);
    if (current !== videoPath) await fs.unlink(current).catch(() => {});
    current = out;
    applied.push("editSfx");
  }

  if (settings.backgroundMusic && settings.backgroundMusic !== "none") {
    onProgress?.({ step: "post", message: "Música de fundo…" });
    const duration = await getVideoDuration(current);
    const musicPath = path.join(workDir, `bed-${timestampSlug()}.m4a`);
    await generateMusicBed(duration, musicPath, settings.backgroundMusic);
    const out = tmp("music");
    await mixBackgroundMusic(current, musicPath, out);
    await fs.unlink(musicPath).catch(() => {});
    if (current !== videoPath) await fs.unlink(current).catch(() => {});
    current = out;
    applied.push("backgroundMusic");
  }

  await fs.copyFile(current, outputPath);
  if (current !== videoPath && current !== outputPath) {
    await fs.unlink(current).catch(() => {});
  }

  return { outputPath, applied };
}
