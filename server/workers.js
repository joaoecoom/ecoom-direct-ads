import fs from "node:fs";
import path from "node:path";
import { resolveAdConfig } from "../src/lib/ad-config.js";
import { regenerateSceneImage, generateStoryboardImages } from "../src/lib/scene-images.js";
import { animateAllSceneVideos, animateSceneVideo } from "../src/lib/scene-videos.js";
import { runAdGeneration, PROJECT_ROOT } from "../src/run-ad-generation.js";
import { createAsset, getAsset, resolveAssetFile } from "./asset-store.js";
import {
  addProjectAssetId,
  applyBlueprint,
  ensureActiveCreative,
  getProject,
  linkJobToProject,
  registerSceneImageAsset,
  registerSceneVideoAsset,
  setProjectCopy,
  setProjectExport,
  updateCreative,
  updateProject,
  updateProjectScene,
} from "./project-store.js";
import { safeUpdateJob, updateJob } from "./job-store.js";
import { pickAdOverrides } from "./ad-overrides.js";
import { rebuildTimelineVideo } from "../src/lib/timeline-rebuild.js";
import { resolveCreative } from "./creative-store.js";
import { shouldUseUgcFlow } from "../src/lib/ugc-flow.js";
import { resolveSceneVideoPath } from "./timeline.js";
import { syncGenerationAssetsToProject } from "./project-sync.js";
import { generateAssetVariations } from "../src/lib/asset-variations.js";
import { generateImage, generateImageWithReferences } from "../src/lib/imagen.js";
import { generateVideoFromImage, generateVideoFromText } from "../src/lib/veo-client.js";

export function loadStoryboardForProject(project, creativeId = null) {
  const creative = resolveCreative(project, creativeId);
  const storyboardPath = creative?.blueprintPath;

  if (!storyboardPath || !fs.existsSync(storyboardPath)) {
    throw new Error("Blueprint/storyboard em falta. Gera o blueprint primeiro.");
  }

  const storyboard = JSON.parse(fs.readFileSync(storyboardPath, "utf8"));
  return { storyboard, storyboardPath, creativeId: creative?.id };
}

export async function runJob(job, onProgress) {
  const type = job.request?.type || job.type || "full_ad";

  if (type === "blueprint") return runBlueprintJob(job, onProgress);
  if (type === "copy") return runCopyJob(job, onProgress);
  if (type === "images") return runImagesJob(job, onProgress);
  if (type === "scene_image") return runSceneImageJob(job, onProgress);
  if (type === "videos") return runVideosJob(job, onProgress);
  if (type === "scene_video") return runSceneVideoJob(job, onProgress);
  if (type === "rebuild") return runRebuildJob(job, onProgress);
  if (type === "variations") return runVariationsJob(job, onProgress);
  if (type === "standalone_image") return runStandaloneImageJob(job, onProgress);
  if (type === "standalone_video") return runStandaloneVideoJob(job, onProgress);
  if (type === "asset_video") return runAssetVideoJob(job, onProgress);
  return runFullAdJob(job, onProgress);
}

async function resolveSceneImagePath(project, scene) {
  if (!scene?.imageAssetId) {
    throw new Error(`Cena ${scene.id} sem imagem — gera imagens primeiro.`);
  }
  const asset = await getAsset(scene.imageAssetId);
  if (!asset) throw new Error(`Asset imagem ${scene.imageAssetId} não encontrado`);
  return resolveAssetFile(asset);
}

async function resolveProjectAvatarPath(project) {
  const anchorId = project?.avatar?.anchorImageAssetId;
  if (!anchorId) return null;
  const asset = await getAsset(anchorId);
  if (!asset) return null;
  try {
    return resolveAssetFile(asset);
  } catch {
    return null;
  }
}

async function resolveProjectReferencePaths(project) {
  const ids = project?.referenceAssetIds || [];
  const paths = [];
  for (const id of ids) {
    const asset = await getAsset(id);
    if (!asset) continue;
    try {
      paths.push(resolveAssetFile(asset));
    } catch {
      /* skip missing files */
    }
  }
  return paths;
}

async function resolveAttachedRefs(refs = []) {
  const out = [];
  for (const ref of refs) {
    const assetId = typeof ref === "string" ? ref : ref?.assetId;
    const role = typeof ref === "string" ? "other" : ref?.role || "other";
    if (!assetId) continue;
    const asset = await getAsset(assetId);
    if (!asset || asset.type !== "image") continue;
    try {
      out.push({ assetId, role, path: resolveAssetFile(asset) });
    } catch {
      /* skip */
    }
  }
  return out;
}

function promptWithVisualRefs(prompt, refs = []) {
  if (!refs.length) return String(prompt || "").trim();
  const lines = [String(prompt || "").trim(), "", "VISUAL REFERENCES ATTACHED:"];
  for (const ref of refs) {
    if (ref.role === "face") {
      lines.push(
        "- FACE IDENTITY: use this exact face (age, skin texture, hair). Do not invent a different person.",
      );
    } else if (ref.role === "product") {
      lines.push(
        "- PRODUCT / PACKAGING: this item must appear naturally (held in hand, on table, or packshot).",
      );
    } else if (ref.role === "clothing") {
      lines.push("- OUTFIT: the person wears this clothing.");
    } else {
      lines.push("- Extra visual element: incorporate this reference in the scene.");
    }
  }
  return lines.join("\n");
}

async function registerVideoAsset({ projectId, sceneId, clipPath, prompt, jobId, order, creativeId }) {
  const asset = await createAsset({
    projectId,
    sceneId,
    type: "video",
    source: "generated",
    prompt,
    sourcePath: clipPath,
    ext: "mp4",
    metadata: { jobId, order },
  });
  await registerSceneVideoAsset(projectId, sceneId, asset.id, creativeId);
  await addProjectAssetId(projectId, asset.id);
  return asset;
}

async function runCopyJob(job, onProgress) {
  const { offer, overrides, projectId, wizard, creativeId } = job.request;
  if (!projectId) throw new Error("projectId obrigatório para copy");
  await ensureActiveCreative(projectId);
  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;

  const result = await runAdGeneration({
    offer,
    overrides,
    runId: job.id,
    copyOnly: true,
    wizard,
    onProgress,
  });

  await setProjectCopy(projectId, result.copy, result.copyPath, cid);

  return { copy: result.copy, copyPath: result.copyPath, creativeId: cid };
}

async function runFullAdJob(job, onProgress) {
  const { offer, overrides = {}, projectId, approvedCopy, wizard, creativeId } = job.request;
  let copy = approvedCopy;
  if (!copy && projectId) {
    const project = await getProject(projectId);
    copy = resolveCreative(project, creativeId)?.copy || project?.latestCopy;
  }

  if (projectId) {
    await ensureActiveCreative(projectId);
  }

  await onProgress?.({ step: "config", message: "A preparar pipeline completo..." });

  const result = await runAdGeneration({
    offer,
    overrides: { ...pickAdOverrides(overrides), useCopyFirst: !copy },
    runId: job.id,
    approvedCopy: copy || null,
    wizard,
    onProgress,
  });

  if (projectId) {
    const project = await getProject(projectId);
    const cid = creativeId || project.activeCreativeId;
    if (result.copy) {
      await setProjectCopy(projectId, result.copy, result.copyPath, cid);
    }
    await applyBlueprint(projectId, {
      storyboardPath: result.storyboardPath,
      storyboard: result.storyboard,
      creativeId: cid,
    });
    await syncGenerationAssetsToProject(projectId, job.id, result, cid);
    await linkJobToProject(
      projectId,
      job.id,
      {
        title: result.storyboard?.title,
        storyboardPath: result.storyboardPath,
        finalVideo: result.finalVideo,
        copyPath: result.copyPath,
        status: "completed",
        type: "full_ad",
      },
      cid,
    );
  }

  return {
    finalVideo: result.finalVideo,
    copyPath: result.copyPath,
    copy: result.copy,
    storyboardPath: result.storyboardPath,
    title: result.storyboard?.title,
    storyboard: result.storyboard,
    generatedImages: result.generatedImages,
    sceneClipPaths: result.sceneClipPaths,
    manifest: result.manifest,
    runId: result.runId,
  };
}

async function runBlueprintJob(job, onProgress) {
  const { offer, overrides, projectId, approvedCopy, wizard, creativeId } = job.request;
  if (!projectId) throw new Error("projectId obrigatório para blueprint");
  await ensureActiveCreative(projectId);
  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;

  let copy = approvedCopy;
  if (!copy) {
    copy = resolveCreative(project, cid)?.copy || project.latestCopy;
  }

  const result = await runAdGeneration({
    offer,
    overrides: { ...overrides, useCopyFirst: !copy },
    runId: job.id,
    storyboardOnly: true,
    approvedCopy: copy || null,
    wizard,
    onProgress,
  });

  if (result.copy) {
    await setProjectCopy(projectId, result.copy, result.copyPath, cid);
  }

  await applyBlueprint(projectId, {
    storyboardPath: result.storyboardPath,
    storyboard: result.storyboard,
    creativeId: cid,
  });

  return {
    storyboardPath: result.storyboardPath,
    storyboard: result.storyboard,
    title: result.storyboard?.title,
    creativeId: cid,
  };
}

async function runImagesJob(job, onProgress) {
  const { projectId, creativeId } = job.request;
  if (!projectId) throw new Error("projectId obrigatório");

  let project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");
  const cid = creativeId || project.activeCreativeId;

  const { storyboard } = loadStoryboardForProject(project, cid);
  const adConfig = resolveAdConfig(project.settings || job.request.overrides || {});
  const outputDir = path.join(PROJECT_ROOT, "assets", `project-${projectId}`, job.id);

  await updateProject(projectId, {
    creatives: project.creatives.map((c) =>
      c.id === cid
        ? {
            ...c,
            scenes: (c.scenes || []).map((s) => ({
              ...s,
              status: { ...s.status, image: "generating" },
            })),
          }
        : c,
    ),
  });

  const { images } = await generateStoryboardImages({
    storyboard,
    adConfig,
    outputDir,
    avatarImagePath: await resolveProjectAvatarPath(project),
    referenceImagePaths: await resolveProjectReferencePaths(project),
    onProgress: (u) =>
      onProgress?.({
        step: u.step,
        message: u.message,
        sceneIndex: u.sceneIndex,
        sceneTotal: u.sceneTotal,
      }),
  });

  const assetIds = [];
  for (const img of images) {
    const asset = await createAsset({
      projectId,
      sceneId: img.sceneId,
      type: "image",
      source: "generated",
      prompt: img.prompt,
      sourcePath: img.path,
      metadata: { order: img.order, jobId: job.id },
    });
    assetIds.push(asset.id);
    await registerSceneImageAsset(projectId, img.sceneId, asset.id, cid);
    await addProjectAssetId(projectId, asset.id);
  }

  return { assetIds, imageCount: images.length, outputDir };
}

async function runSceneImageJob(job, onProgress) {
  const { projectId, sceneId, creativeId } = job.request;
  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");
  const cid = creativeId || project.activeCreativeId;

  const { storyboard } = loadStoryboardForProject(project, cid);
  const adConfig = resolveAdConfig(project.settings || {});
  const creative = resolveCreative(project, cid);
  const scenes = creative?.scenes || [];
  const outputDir = path.join(PROJECT_ROOT, "assets", `project-${projectId}`, job.id);

  await updateProjectScene(
    projectId,
    sceneId,
    { status: { image: "generating" } },
    cid,
  );

  onProgress?.({ step: "image", message: `A regenerar imagem: ${sceneId}` });

  const sceneIndex = scenes.findIndex((s) => s.id === sceneId);
  let previousImagePath = null;
  let anchorImagePath = await resolveProjectAvatarPath(project);

  if (sceneIndex > 0) {
    const prevScene = scenes[sceneIndex - 1];
    if (prevScene?.imageAssetId) {
      const prevAsset = await getAsset(prevScene.imageAssetId);
      if (prevAsset) previousImagePath = resolveAssetFile(prevAsset);
    }
    if (!anchorImagePath) {
      const firstScene = scenes[0];
      if (firstScene?.imageAssetId) {
        const firstAsset = await getAsset(firstScene.imageAssetId);
        if (firstAsset) anchorImagePath = resolveAssetFile(firstAsset);
      }
    }
  }

  const img = await regenerateSceneImage({
    storyboard,
    adConfig,
    sceneId,
    outputDir,
    anchorImagePath,
    previousImagePath,
  });

  const asset = await createAsset({
    projectId,
    sceneId,
    type: "image",
    source: "generated",
    prompt: img.prompt,
    sourcePath: img.path,
    metadata: { order: img.order, jobId: job.id, regenerated: true },
  });

  await registerSceneImageAsset(projectId, sceneId, asset.id, cid);
  await addProjectAssetId(projectId, asset.id);

  return { assetId: asset.id, sceneId };
}

async function runVideosJob(job, onProgress) {
  const { projectId, creativeId } = job.request;
  if (!projectId) throw new Error("projectId obrigatório");

  let project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");
  const cid = creativeId || project.activeCreativeId;

  const { storyboard } = loadStoryboardForProject(project, cid);
  const adConfig = resolveAdConfig(project.settings || {});
  const creative = resolveCreative(project, cid);
  const scenes = creative?.scenes || [];

  if (!scenes.length) {
    throw new Error("Sem cenas — gera blueprint primeiro.");
  }

  const missing = scenes.filter((s) => !s.imageAssetId);
  if (missing.length) {
    throw new Error(
      `${missing.length} cena(s) sem imagem — Generate All Images primeiro.`,
    );
  }

  const isUgcFlow = shouldUseUgcFlow(storyboard, adConfig, scenes.length);

  const outputDir = path.join(
    PROJECT_ROOT,
    "output",
    `project-${projectId}`,
    `videos-${job.id}`,
  );

  await updateProject(projectId, {
    creatives: project.creatives.map((c) =>
      c.id === cid
        ? {
            ...c,
            scenes: scenes.map((s) => ({
              ...s,
              status: { ...s.status, video: "generating" },
            })),
          }
        : c,
    ),
  });

  const getImagePath = async (scene) => {
    project = (await getProject(projectId)) || project;
    const freshCreative = resolveCreative(project, cid);
    const fresh = freshCreative?.scenes?.find((s) => s.id === scene.id) || scene;
    return resolveSceneImagePath(project, fresh);
  };

  const { clips } = await animateAllSceneVideos({
    storyboard,
    adConfig,
    scenes,
    getImagePath,
    outputDir,
    onProgress: (u) =>
      onProgress?.({
        step: u.step,
        message: u.message,
        sceneIndex: u.sceneIndex,
        sceneTotal: u.sceneTotal,
      }),
  });

  const videoAssetIds = [];
  for (const clip of clips) {
    const asset = await registerVideoAsset({
      projectId,
      sceneId: clip.sceneId,
      clipPath: clip.path,
      prompt: clip.prompt,
      jobId: job.id,
      order: clip.order,
      creativeId: cid,
    });
    videoAssetIds.push(asset.id);
  }

  const baseResult = { videoAssetIds, clipCount: clips.length, outputDir, veoFlow: isUgcFlow };

  if (job.request.autoRebuild !== false) {
    onProgress?.({
      step: "rebuild",
      message: "A montar vídeo final — pronto para export…",
    });
    const rebuildResult = await runRebuildJob(
      {
        id: job.id,
        request: { type: "rebuild", projectId, creativeId: cid },
      },
      onProgress,
    );
    return {
      ...baseResult,
      ...rebuildResult,
      exportReady: true,
      autoRebuilt: true,
    };
  }

  return baseResult;
}

async function runSceneVideoJob(job, onProgress) {
  const { projectId, sceneId, motionPrompt: motionPromptOverride, creativeId } = job.request;
  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");
  const cid = creativeId || project.activeCreativeId;

  const { storyboard } = loadStoryboardForProject(project, cid);
  const adConfig = resolveAdConfig(project.settings || {});
  const creative = resolveCreative(project, cid);
  const scenes = creative?.scenes || [];
  const sceneIndex = scenes.findIndex((s) => s.id === sceneId);
  if (sceneIndex === -1) throw new Error(`Cena ${sceneId} não encontrada`);

  const scene = scenes[sceneIndex];
  const imagePath = await resolveSceneImagePath(project, scene);

  let lastFramePath = null;
  if (shouldUseUgcFlow(storyboard, adConfig, scenes.length) && sceneIndex < scenes.length - 1) {
    const next = scenes[sceneIndex + 1];
    if (next?.imageAssetId) {
      lastFramePath = await resolveSceneImagePath(project, next);
    }
  }

  await updateProjectScene(
    projectId,
    sceneId,
    { status: { video: "generating" } },
    cid,
  );

  onProgress?.({
    step: "video",
    message: `A animar ${sceneId}...`,
    sceneIndex: sceneIndex + 1,
    sceneTotal: scenes.length,
  });

  const outputDir = path.join(
    PROJECT_ROOT,
    "output",
    `project-${projectId}`,
    `video-${job.id}`,
  );

  const clip = await animateSceneVideo({
    storyboard,
    adConfig,
    scene,
    sceneIndex,
    sceneTotal: scenes.length,
    imagePath,
    lastFramePath,
    outputDir,
    runLabel: `veo-scene/${sceneId}`,
    motionPromptOverride: motionPromptOverride || scene.motionPrompt || null,
  });

  const asset = await registerVideoAsset({
    projectId,
    sceneId,
    clipPath: clip.path,
    prompt: clip.prompt,
    jobId: job.id,
    order: sceneIndex,
    creativeId: cid,
  });

  return { assetId: asset.id, sceneId, clipPath: clip.path };
}

async function runRebuildJob(job, onProgress) {
  const { projectId, creativeId } = job.request;
  if (!projectId) throw new Error("projectId obrigatório");

  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");
  const cid = creativeId || project.activeCreativeId;
  const creative = resolveCreative(project, cid);

  const { storyboard } = loadStoryboardForProject(project, cid);
  const adConfig = resolveAdConfig(project.settings || {});
  const scenes = [...(creative?.scenes || [])].sort((a, b) => a.order - b.order);

  if (!scenes.length) throw new Error("Sem cenas na timeline.");

  const missing = scenes.filter((s) => !s.videoAssetId);
  if (missing.length) {
    throw new Error(`${missing.length} cena(s) sem clip — Animate All primeiro.`);
  }

  await updateCreative(projectId, cid, { timelineStatus: "building" });

  onProgress?.({ step: "rebuild", message: "A recolher clips..." });

  const clipPaths = [];
  for (const scene of scenes) {
    clipPaths.push(await resolveSceneVideoPath(scene));
  }

  await safeUpdateJob(job.id, {
    request: { ...job.request, clipCount: clipPaths.length },
  });

  const outputDir = path.join(PROJECT_ROOT, "output", `project-${projectId}`, cid);
  const finalPath = path.join(outputDir, `export-${job.id}.mp4`);

  const result = await rebuildTimelineVideo({
    clipPaths,
    sceneIds: scenes.map((s) => s.id),
    outputPath: finalPath,
    storyboard,
    adConfig,
    onProgress,
  });

  const exportAsset = await createAsset({
    projectId,
    type: "video",
    source: "export",
    prompt: creative?.blueprint?.title || creative?.title || "Final export",
    sourcePath: result.finalVideo,
    ext: "mp4",
    metadata: { export: true, jobId: job.id, clipCount: result.clipCount, creativeId: cid },
  });

  await addProjectAssetId(projectId, exportAsset.id);
  await setProjectExport(
    projectId,
    {
      assetId: exportAsset.id,
      jobId: job.id,
      finalVideo: result.finalVideo,
    },
    cid,
  );

  return {
    finalVideo: result.finalVideo,
    exportAssetId: exportAsset.id,
    clipCount: result.clipCount,
    crossfadeSeconds: result.crossfadeSeconds,
  };
}

async function runVariationsJob(job, onProgress) {
  const { projectId, sourceAssetId, prompt, count } = job.request;
  if (!projectId || !sourceAssetId) {
    throw new Error("projectId e sourceAssetId obrigatórios");
  }

  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");

  const source = await getAsset(sourceAssetId);
  if (!source || source.type !== "image") {
    throw new Error("Asset fonte tem de ser uma imagem");
  }

  const referencePath = resolveAssetFile(source);
  const adConfig = resolveAdConfig(project.settings || {});
  const outputDir = path.join(
    PROJECT_ROOT,
    "assets",
    `project-${projectId}`,
    `variations-${job.id}`,
  );

  onProgress?.({ step: "image", message: "A gerar variações..." });

  const { variations } = await generateAssetVariations({
    referenceImagePath: referencePath,
    prompt,
    count: count || 5,
    outputDir,
    aspectRatio: adConfig.aspectRatio || "9:16",
    onProgress: (u) =>
      onProgress?.({
        step: u.step,
        message: u.message,
        sceneIndex: u.sceneIndex,
        sceneTotal: u.sceneTotal,
      }),
  });

  const assetIds = [];
  for (const v of variations) {
    const asset = await createAsset({
      projectId,
      type: "image",
      source: "variation",
      prompt: v.prompt,
      sourcePath: v.path,
      metadata: { order: v.order, jobId: job.id, sourceAssetId, variation: true },
    });
    assetIds.push(asset.id);
    await addProjectAssetId(projectId, asset.id);
  }

  return { assetIds, variationCount: assetIds.length, sourceAssetId };
}

async function runStandaloneImageJob(job, onProgress) {
  const { projectId, prompt, count, references } = job.request;
  if (!projectId || !String(prompt || "").trim()) {
    throw new Error("projectId e prompt obrigatórios");
  }

  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");

  const refs = await resolveAttachedRefs(references);
  const finalPrompt = promptWithVisualRefs(prompt, refs);
  const adConfig = resolveAdConfig(project.settings || {});
  const n = Math.min(Math.max(1, Number(count) || 1), 12);
  const outputDir = path.join(PROJECT_ROOT, "assets", `project-${projectId}`, `gen-${job.id}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const assetIds = [];
  for (let i = 0; i < n; i++) {
    onProgress?.({
      step: "image",
      message: refs.length
        ? `Nano Banana Pro + ${refs.length} ref(s) — ${i + 1}/${n}`
        : `Nano Banana Pro — imagem ${i + 1}/${n}`,
      sceneIndex: i + 1,
      sceneTotal: n,
    });
    const outputPath = path.join(outputDir, `image-${String(i + 1).padStart(2, "0")}.png`);
    if (refs.length) {
      await generateImageWithReferences({
        prompt: finalPrompt,
        referenceImagePaths: refs.map((r) => r.path),
        outputPath,
        aspectRatio: adConfig.aspectRatio || "9:16",
        ugc: true,
      });
    } else {
      await generateImage({
        prompt: finalPrompt,
        outputPath,
        aspectRatio: adConfig.aspectRatio || "9:16",
        ugc: true,
      });
    }
    const asset = await createAsset({
      projectId,
      type: "image",
      source: "generated",
      prompt: finalPrompt,
      sourcePath: outputPath,
      ext: "png",
      metadata: {
        jobId: job.id,
        order: i + 1,
        role: "studio",
        referenceAssetIds: refs.map((r) => r.assetId),
      },
    });
    assetIds.push(asset.id);
    await addProjectAssetId(projectId, asset.id);
  }

  return { assetIds, count: assetIds.length, referenceCount: refs.length };
}

async function runStandaloneVideoJob(job, onProgress) {
  const { projectId, prompt, references } = job.request;
  if (!projectId || !String(prompt || "").trim()) {
    throw new Error("projectId e prompt obrigatórios");
  }

  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");

  const refs = await resolveAttachedRefs(references);
  const finalPrompt = promptWithVisualRefs(prompt, refs);
  const adConfig = resolveAdConfig(project.settings || {});
  const outputDir = path.join(PROJECT_ROOT, "assets", `project-${projectId}`, `veo-${job.id}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFileName = path.join(outputDir, "clip.mp4");

  let clip;
  if (refs.length) {
    onProgress?.({
      step: "image",
      message: `A compor frame com ${refs.length} referência(s)…`,
    });
    const composedPath = path.join(outputDir, "composed.png");
    await generateImageWithReferences({
      prompt: finalPrompt,
      referenceImagePaths: refs.map((r) => r.path),
      outputPath: composedPath,
      aspectRatio: adConfig.aspectRatio || "9:16",
      ugc: true,
    });
    onProgress?.({ step: "video", message: "Veo — a animar o frame composto…" });
    clip = await generateVideoFromImage({
      imagePath: composedPath,
      prompt: finalPrompt,
      aspectRatio: adConfig.aspectRatio || "9:16",
      durationSeconds: adConfig.clipDurationSeconds || 8,
      resolution: adConfig.resolution,
      outputFileName,
      runLabel: `studio-video-refs/${job.id}`,
    });
  } else {
    onProgress?.({ step: "video", message: "Veo — a gerar vídeo a partir do prompt…" });
    clip = await generateVideoFromText({
      prompt: finalPrompt,
      aspectRatio: adConfig.aspectRatio || "9:16",
      durationSeconds: adConfig.clipDurationSeconds || 8,
      resolution: adConfig.resolution,
      outputFileName,
      runLabel: `studio-video/${job.id}`,
    });
  }

  const asset = await createAsset({
    projectId,
    type: "video",
    source: "generated",
    prompt: finalPrompt,
    sourcePath: clip.localPath,
    ext: "mp4",
    metadata: {
      jobId: job.id,
      role: "studio",
      type: refs.length ? "refs-to-video" : "text-to-video",
      referenceAssetIds: refs.map((r) => r.assetId),
    },
  });
  await addProjectAssetId(projectId, asset.id);
  return { assetId: asset.id, videoAssetIds: [asset.id], referenceCount: refs.length };
}

async function runAssetVideoJob(job, onProgress) {
  const { projectId, sourceAssetId, lastFrameAssetId, prompt, references } = job.request;
  if (!projectId || !sourceAssetId) {
    throw new Error("projectId e sourceAssetId obrigatórios");
  }

  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");

  const source = await getAsset(sourceAssetId);
  if (!source || source.type !== "image") {
    throw new Error("Selecciona uma imagem para animar");
  }

  const extraRefs = (await resolveAttachedRefs(references)).filter(
    (r) => r.assetId !== sourceAssetId,
  );
  const allRefs = [
    { assetId: sourceAssetId, role: "face", path: resolveAssetFile(source) },
    ...extraRefs,
  ];
  const motion = promptWithVisualRefs(
    String(prompt || "").trim() ||
      source.prompt ||
      "Natural handheld camera, authentic UGC, person moving naturally, preserve identity.",
    extraRefs,
  );

  let lastFramePath;
  if (lastFrameAssetId) {
    const last = await getAsset(lastFrameAssetId);
    if (last?.type === "image") {
      try {
        lastFramePath = resolveAssetFile(last);
      } catch {
        lastFramePath = undefined;
      }
    }
  }

  const adConfig = resolveAdConfig(project.settings || {});
  const outputDir = path.join(PROJECT_ROOT, "assets", `project-${projectId}`, `animate-${job.id}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFileName = path.join(outputDir, "clip.mp4");

  let imagePath = resolveAssetFile(source);
  if (extraRefs.length) {
    onProgress?.({
      step: "image",
      message: `A aplicar ${extraRefs.length} referência(s) no frame…`,
    });
    const composedPath = path.join(outputDir, "composed.png");
    await generateImageWithReferences({
      prompt: motion,
      referenceImagePaths: allRefs.map((r) => r.path),
      outputPath: composedPath,
      aspectRatio: adConfig.aspectRatio || "9:16",
      ugc: true,
    });
    imagePath = composedPath;
  }

  onProgress?.({
    step: "video",
    message: lastFramePath ? "Veo — interpolar Inicial → Final…" : "Veo — a animar imagem…",
  });

  const clip = await generateVideoFromImage({
    imagePath,
    lastFramePath,
    prompt: motion,
    aspectRatio: adConfig.aspectRatio || "9:16",
    durationSeconds: adConfig.clipDurationSeconds || 8,
    resolution: adConfig.resolution,
    outputFileName,
    runLabel: `studio-animate/${job.id}`,
  });

  const asset = await createAsset({
    projectId,
    type: "video",
    source: "generated",
    prompt: motion,
    sourcePath: clip.localPath,
    ext: "mp4",
    metadata: {
      jobId: job.id,
      role: "studio",
      type: extraRefs.length ? "image-refs-to-video" : "image-to-video",
      sourceAssetId,
      referenceAssetIds: extraRefs.map((r) => r.assetId),
    },
  });
  await addProjectAssetId(projectId, asset.id);
  return { assetId: asset.id, videoAssetIds: [asset.id], sourceAssetId };
}

export async function persistJobProgress(jobId, update) {
  await safeUpdateJob(jobId, {
    status: "running",
    progress: {
      step: update.step,
      message: update.message,
      sceneIndex: update.sceneIndex,
      sceneTotal: update.sceneTotal,
    },
  });
}

export async function persistJobComplete(jobId, result) {
  await updateJob(jobId, {
    status: "completed",
    progress: { step: "done", message: "Concluído" },
    result,
  });
}

export async function persistJobFailed(jobId, err) {
  await updateJob(jobId, {
    status: "failed",
    error: err.message,
    progress: { step: "error", message: err.message },
  });
}
