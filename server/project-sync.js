import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/run-ad-generation.js";
import { createAsset } from "./asset-store.js";
import {
  addProjectAssetId,
  getProject,
  registerSceneImageAsset,
  registerSceneVideoAsset,
  setProjectExport,
  updateProject,
} from "./project-store.js";

function sceneIdAt(storyboard, index) {
  return storyboard.scenes[index]?.id || `parte-${index + 1}`;
}

function resolveClipPath(runId, storyboard, index, explicitPaths = []) {
  if (explicitPaths[index] && fs.existsSync(explicitPaths[index])) {
    return explicitPaths[index];
  }

  const id = sceneIdAt(storyboard, index);
  const candidates = [
    path.join(PROJECT_ROOT, "output", `synced-${runId}`, `${id}-synced.mp4`),
    path.join(PROJECT_ROOT, "output", `voiced-${runId}`, `${id}.mp4`),
    path.join(PROJECT_ROOT, "output", "scenes", `${id}.mp4`),
    path.join(PROJECT_ROOT, "assets", `run-${runId}`, `${id}.mp4`),
  ];

  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Liga imagens, clips e export de um full_ad (ou job equivalente) ao projecto.
 */
export async function syncGenerationAssetsToProject(projectId, jobId, result, creativeId = null) {
  const { storyboard, finalVideo, runId = jobId } = result;
  if (!storyboard?.scenes?.length) {
    throw new Error("Storyboard em falta no resultado do job.");
  }

  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;
  if (!cid) throw new Error("Nenhum vídeo activo.");

  const assetsRunDir =
    result.assetsRunDir || path.join(PROJECT_ROOT, "assets", `run-${runId}`);
  const generatedImages = result.generatedImages || [];
  const sceneClipPaths = result.sceneClipPaths || result.manifest?.clips || [];

  const imageAssetIds = [];

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const sceneId = sceneIdAt(storyboard, i);
    const imagePath =
      generatedImages[i]?.path || path.join(assetsRunDir, `${sceneId}.png`);

    if (!fs.existsSync(imagePath)) continue;

    const asset = await createAsset({
      projectId,
      sceneId,
      type: "image",
      source: "generated",
      prompt: scene.imagePrompt || scene.visualBeat || "",
      sourcePath: imagePath,
      metadata: { order: i, jobId, syncedFromJob: true, creativeId: cid },
    });
    await registerSceneImageAsset(projectId, sceneId, asset.id, cid);
    await addProjectAssetId(projectId, asset.id);
    imageAssetIds.push(asset.id);
  }

  for (let i = 0; i < storyboard.scenes.length; i++) {
    const scene = storyboard.scenes[i];
    const sceneId = sceneIdAt(storyboard, i);
    const clipPath = resolveClipPath(runId, storyboard, i, sceneClipPaths);
    if (!clipPath) continue;

    const asset = await createAsset({
      projectId,
      sceneId,
      type: "video",
      source: "generated",
      prompt: scene.motionPrompt || scene.visualBeat || "",
      sourcePath: clipPath,
      ext: "mp4",
      metadata: { jobId, order: i, creativeId: cid },
    });
    await registerSceneVideoAsset(projectId, sceneId, asset.id, cid);
    await addProjectAssetId(projectId, asset.id);
  }

  if (finalVideo && fs.existsSync(finalVideo)) {
    const exportAsset = await createAsset({
      projectId,
      type: "video",
      source: "export",
      prompt: storyboard.title || "Final export",
      sourcePath: finalVideo,
      ext: "mp4",
      metadata: { export: true, jobId, syncedFromJob: true, creativeId: cid },
    });
    await addProjectAssetId(projectId, exportAsset.id);
    await setProjectExport(
      projectId,
      {
        assetId: exportAsset.id,
        jobId,
        finalVideo,
      },
      cid,
    );
  }

  const anchorImageAssetId = imageAssetIds[0] || null;
  if (anchorImageAssetId) {
    await updateProject(projectId, {
      avatar: {
        characterBrief: storyboard.characterBrief || "",
        settingBrief: storyboard.settingBrief || "",
        anchorImageAssetId,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  const refreshed = await getProject(projectId);
  const creative = refreshed.creatives.find((c) => c.id === cid);
  return {
    imageCount: imageAssetIds.length,
    clipCount: creative?.scenes?.filter((s) => s.videoAssetId).length || 0,
    exportReady: Boolean(creative?.latestExport),
    avatarSet: Boolean(anchorImageAssetId),
    creativeId: cid,
  };
}
