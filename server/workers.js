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
  linkAssetToScene,
  linkJobToProject,
  registerSceneImageAsset,
  registerSceneVideoAsset,
  setProjectCopy,
  setProjectExport,
  updateCreative,
  updateProject,
  updateProjectScene,
} from "./project-store.js";
import { pickAdOverrides } from "./ad-overrides.js";
import { rebuildTimelineVideo } from "../src/lib/timeline-rebuild.js";
import { resolveCreative } from "./creative-store.js";
import { resolveSceneVideoPath } from "./timeline.js";
import { syncGenerationAssetsToProject } from "./project-sync.js";

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
  const { projectId, sceneId } = job.request;
  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");

  const { storyboard } = loadStoryboardForProject(project);
  const adConfig = resolveAdConfig(project.settings || {});
  const creative = resolveCreative(project, cid);
  const scenes = creative?.scenes || [];
  const outputDir = path.join(PROJECT_ROOT, "assets", `project-${projectId}`, job.id);

  await updateProjectScene(projectId, sceneId, {
    status: { image: "generating" },
  });

  onProgress?.({ step: "image", message: `A regenerar imagem: ${sceneId}` });

  const sceneIndex = project.scenes.findIndex((s) => s.id === sceneId);
  let referenceImagePath = null;
  if (sceneIndex > 0) {
    const prevScene = project.scenes[sceneIndex - 1];
    if (prevScene?.imageAssetId) {
      const prevAsset = await getAsset(prevScene.imageAssetId);
      if (prevAsset) referenceImagePath = resolveAssetFile(prevAsset);
    }
  }

  const img = await regenerateSceneImage({
    storyboard,
    adConfig,
    sceneId,
    outputDir,
    referenceImagePath,
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

  await linkAssetToScene(projectId, sceneId, asset.id);
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

  return { videoAssetIds, clipCount: clips.length, outputDir };
}

async function runSceneVideoJob(job, onProgress) {
  const { projectId, sceneId, motionPrompt: motionPromptOverride } = job.request;
  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");

  const { storyboard } = loadStoryboardForProject(project);
  const adConfig = resolveAdConfig(project.settings || {});
  const scenes = project.scenes || [];
  const sceneIndex = scenes.findIndex((s) => s.id === sceneId);
  if (sceneIndex === -1) throw new Error(`Cena ${sceneId} não encontrada`);

  const scene = scenes[sceneIndex];
  const imagePath = await resolveSceneImagePath(project, scene);

  let lastFramePath = null;
  if (storyboard.style === "ugc" && sceneIndex < scenes.length - 1) {
    const next = scenes[sceneIndex + 1];
    if (next?.imageAssetId) {
      lastFramePath = await resolveSceneImagePath(project, next);
    }
  }

  await updateProjectScene(projectId, sceneId, {
    status: { video: "generating" },
  });

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
