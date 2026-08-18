import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureOutputDir, loadConfig, timestampSlug } from "./config.js";
import { concatenateVideos } from "./lib/concat-videos.js";
import { buildFlowMotionPrompt } from "./lib/image-prompts.js";
import { generateVideoFromImage } from "./lib/veo-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

/**
 * Pipeline: N imagens → N clips Veo → 1 MP4 fluido
 *
 * spec.flow = true → cada clip interpola imagem[i] → imagem[i+1] (Veo first/last frame)
 * spec.crossfadeSeconds → FFmpeg crossfade no final (default 0.35)
 */
export async function runSequence(spec) {
  const scenes = spec.scenes;
  const flow = spec.flow === true;
  const onProgress = spec.onProgress;
  const crossfadeSeconds =
    spec.crossfadeSeconds ??
    Number.parseFloat(process.env.VIDEO_CROSSFADE_SECONDS || "0.35");
  const keepAudio = spec.keepAudio === true;

  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("Spec precisa de array 'scenes'.");
  }

  const config = loadConfig();
  await ensureOutputDir(path.join(config.outputDir, "scenes"));

  console.log(
    `\n🎞️  Sequência: ${scenes.length} imagem(ns) → ${scenes.length} clip(s) → 1 vídeo`,
  );
  if (flow) {
    console.log("   Modo FLOW: Veo interpola entre frames consecutivos\n");
  } else {
    console.log("");
  }

  const clips = [];
  const clipDuration = spec.durationSeconds ?? 8;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const id = scene.id || `scene-${i + 1}`;

    if (!scene.image) throw new Error(`Cena ${id}: falta "image"`);
    if (!scene.prompt) throw new Error(`Cena ${id}: falta "prompt"`);

    const imagePath = path.isAbsolute(scene.image)
      ? scene.image
      : path.resolve(ROOT, scene.image);

    let lastFramePath = null;
    if (flow && scene.lastFrameImage) {
      lastFramePath = path.isAbsolute(scene.lastFrameImage)
        ? scene.lastFrameImage
        : path.resolve(ROOT, scene.lastFrameImage);
    } else if (flow && i < scenes.length - 1 && scenes[i + 1].image) {
      const next = scenes[i + 1].image;
      lastFramePath = path.isAbsolute(next) ? next : path.resolve(ROOT, next);
    }

    const motionPrompt =
      scene.prompt ||
      buildFlowMotionPrompt(
        scene.durationSeconds ?? clipDuration,
        scene.visualBeat || "",
      );

    console.log(`--- [${i + 1}/${scenes.length}] ${id}${flow && lastFramePath ? " (flow→)" : ""} ---`);

    onProgress?.({
      step: "video",
      sceneIndex: i + 1,
      sceneTotal: scenes.length,
      sceneId: id,
      message: `Veo ${i + 1}/${scenes.length} — ${id}`,
    });

    const clip = await generateVideoFromImage({
      imagePath,
      lastFramePath: flow ? lastFramePath : undefined,
      prompt: motionPrompt,
      model: scene.model || spec.model,
      aspectRatio: scene.aspectRatio || spec.aspectRatio || "9:16",
      durationSeconds: scene.durationSeconds ?? clipDuration,
      resolution: scene.resolution || spec.resolution,
      negativePrompt: scene.negativePrompt,
      outputFileName: path.join("scenes", `${id}.mp4`),
      runLabel: `veo-sequence/${id}`,
    });

    clips.push(clip.localPath);
  }

  const finalName = spec.outputFileName || `ad-${timestampSlug()}.mp4`;
  const finalPath = path.join(config.outputDir, finalName);

  console.log("🔗 A juntar clips (crossfade fluido)...");
  await concatenateVideos(clips, finalPath, { crossfadeSeconds, keepAudio });

  const manifest = {
    finalVideo: finalPath,
    clips,
    scenes,
    flow,
    crossfadeSeconds,
    storyboard: spec.storyboard || null,
    createdAt: new Date().toISOString(),
  };

  const manifestPath = path.join(
    config.outputDir,
    `sequence-${timestampSlug()}.json`,
  );
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.log("\n✅ Vídeo final:");
  console.log(`   ${finalPath}`);
  console.log(`   Manifest: ${manifestPath}\n`);

  return manifest;
}

async function loadJobsFromArg(arg) {
  if (!arg) {
    const defaultFile = path.join(ROOT, "prompts", "sequencia-exemplo.json");
    const raw = await fs.readFile(defaultFile, "utf8");
    return JSON.parse(raw);
  }

  if (arg.endsWith(".json")) {
    const raw = await fs.readFile(path.resolve(process.cwd(), arg), "utf8");
    return JSON.parse(raw);
  }

  const args = process.argv.slice(2);
  if (args.length < 2 || args.length % 2 !== 0) {
    throw new Error(
      'Formato: npm run sequence -- img1.png "motion" img2.png "motion" ...',
    );
  }

  const scenes = [];
  for (let i = 0; i < args.length; i += 2) {
    scenes.push({
      id: `scene-${scenes.length + 1}`,
      image: args[i],
      prompt: args[i + 1],
    });
  }
  return { scenes, outputFileName: `ad-${timestampSlug()}.mp4`, flow: true };
}

const isMain = process.argv[1]?.endsWith("generate-sequence.js");
if (isMain) {
  loadJobsFromArg(process.argv[2])
    .then(runSequence)
    .catch((err) => {
      console.error("\n❌ Erro sequência:", err.message);
      process.exit(1);
    });
}
