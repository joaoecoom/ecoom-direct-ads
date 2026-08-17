import fs from "node:fs";
import path from "node:path";
import { resolveAdConfig } from "../src/lib/ad-config.js";
import { regenerateSceneImage, generateStoryboardImages } from "../src/lib/scene-images.js";
import { runAdGeneration, PROJECT_ROOT } from "../src/run-ad-generation.js";
import { createAsset, getAsset, resolveAssetFile } from "./asset-store.js";
import {
  addProjectAssetId,
  applyBlueprint,
  getProject,
  linkAssetToScene,
  linkJobToProject,
  updateProject,
  updateProjectScene,
} from "./project-store.js";
import { updateJob } from "./job-store.js";

export function loadStoryboardForProject(project) {
  const storyboardPath =
    project.blueprintPath || project.latestCreative?.storyboardPath;

  if (!storyboardPath || !fs.existsSync(storyboardPath)) {
    throw new Error("Blueprint/storyboard em falta. Gera o blueprint primeiro.");
  }

  const storyboard = JSON.parse(fs.readFileSync(storyboardPath, "utf8"));
  return { storyboard, storyboardPath };
}

export async function runJob(job, onProgress) {
  const type = job.request?.type || job.type || "full_ad";

  if (type === "blueprint") return runBlueprintJob(job, onProgress);
  if (type === "images") return runImagesJob(job, onProgress);
  if (type === "scene_image") return runSceneImageJob(job, onProgress);
  return runFullAdJob(job, onProgress);
}

async function runFullAdJob(job, onProgress) {
  const { offer, overrides, projectId } = job.request;
  const result = await runAdGeneration({
    offer,
    overrides,
    runId: job.id,
    onProgress,
  });

  if (projectId) {
    await applyBlueprint(projectId, {
      storyboardPath: result.storyboardPath,
      storyboard: result.storyboard,
    });
    await linkJobToProject(projectId, job.id, {
      title: result.storyboard?.title,
      storyboardPath: result.storyboardPath,
      finalVideo: result.finalVideo,
      copyPath: result.copyPath,
      status: "completed",
      type: "full_ad",
    });
  }

  return {
    finalVideo: result.finalVideo,
    copyPath: result.copyPath,
    copy: result.copy,
    storyboardPath: result.storyboardPath,
    title: result.storyboard?.title,
    storyboard: result.storyboard,
  };
}

async function runBlueprintJob(job, onProgress) {
  const { offer, overrides, projectId } = job.request;
  if (!projectId) throw new Error("projectId obrigatório para blueprint");

  const result = await runAdGeneration({
    offer,
    overrides,
    runId: job.id,
    storyboardOnly: true,
    onProgress,
  });

  await applyBlueprint(projectId, {
    storyboardPath: result.storyboardPath,
    storyboard: result.storyboard,
  });

  return {
    storyboardPath: result.storyboardPath,
    storyboard: result.storyboard,
    title: result.storyboard?.title,
  };
}

async function runImagesJob(job, onProgress) {
  const { projectId } = job.request;
  if (!projectId) throw new Error("projectId obrigatório");

  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");

  const { storyboard } = loadStoryboardForProject(project);
  const adConfig = resolveAdConfig(project.settings || job.request.overrides || {});
  const outputDir = path.join(PROJECT_ROOT, "assets", `project-${projectId}`, job.id);

  await updateProject(projectId, {
    scenes: project.scenes.map((s) => ({
      ...s,
      status: { ...s.status, image: "generating" },
    })),
  });

  const { images } = await generateStoryboardImages({
    storyboard,
    adConfig,
    outputDir,
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
    await linkAssetToScene(projectId, img.sceneId, asset.id);
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

export async function persistJobProgress(jobId, update) {
  await updateJob(jobId, {
    status: "running",
    progress: { step: update.step, message: update.message },
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
