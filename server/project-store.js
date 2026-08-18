import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  statusAfterImageChange,
  statusAfterMotionPromptChange,
  statusAfterVideoChange,
} from "./scene-deps.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_DIR = path.join(__dirname, "..", "data", "projects");

export const DEFAULT_PROJECT_SETTINGS = {
  language: "pt",
  languageVariant: "pt-BR",
  aspectRatio: "9:16",
  clipDurationSeconds: 8,
  sceneCount: 3,
  totalDurationSeconds: 24,
  resolution: "1080p",
  tone: "amigavel",
  style: "ugc",
};

async function ensureProjectsDir() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true });
}

function projectPath(id) {
  return path.join(PROJECTS_DIR, `${id}.json`);
}

function normalizeProject(raw) {
  const latestExport = raw.latestExport || null;
  return {
    ...raw,
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...raw.settings },
    jobIds: raw.jobIds || [],
    creatives: raw.creatives || [],
    scenes: (raw.scenes || []).map((s) => normalizeScene(s, Boolean(latestExport))),
    assetIds: raw.assetIds || [],
    blueprintPath: raw.blueprintPath || null,
    blueprint: raw.blueprint || null,
    latestExport,
    timelineStatus: raw.timelineStatus || "pending",
  };
}

export function storyboardToScenes(storyboard) {
  return (storyboard.scenes || []).map((s, i) => ({
    id: s.id || `parte-${i + 1}`,
    order: i,
    role: s.role || "",
    imagePrompt: s.imagePrompt || "",
    motionPrompt: s.motionPrompt || "",
    voiceoverLine: s.voiceoverLine || "",
    visualBeat: s.visualBeat || "",
    onScreenText: s.onScreenText || "",
    imageAssetId: null,
    videoAssetId: null,
    imageVersions: [],
    videoVersions: [],
    status: { prompt: "done", image: "pending", video: "pending", final: "pending" },
  }));
}

function normalizeScene(scene, projectHasExport = false) {
  const imageVersions =
    scene.imageVersions?.length
      ? scene.imageVersions
      : scene.imageAssetId
        ? [scene.imageAssetId]
        : [];
  const videoVersions =
    scene.videoVersions?.length
      ? scene.videoVersions
      : scene.videoAssetId
        ? [scene.videoAssetId]
        : [];

  return {
    ...scene,
    imageVersions,
    videoVersions,
    status: {
      prompt: "done",
      image: "pending",
      video: "pending",
      final: projectHasExport ? "pending" : "pending",
      ...scene.status,
    },
  };
}

export async function applyBlueprint(projectId, { storyboardPath, storyboard }) {
  return updateProject(projectId, {
    blueprintPath: storyboardPath,
    blueprint: {
      title: storyboard.title,
      hook: storyboard.hook,
      sceneCount: storyboard.scenes?.length || 0,
    },
    scenes: storyboardToScenes(storyboard),
  });
}

export async function updateProjectScene(projectId, sceneId, patch) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} não encontrado`);
  const scenes = project.scenes.map((s) => {
    if (s.id !== sceneId) return s;

    let status = s.status;
    if (patch.motionPrompt !== undefined && patch.motionPrompt !== s.motionPrompt) {
      status = statusAfterMotionPromptChange(s, Boolean(project.latestExport));
    }
    if (patch.status) {
      status = { ...status, ...patch.status };
    }

    const { status: _ignored, ...restPatch } = patch;
    return { ...s, ...restPatch, status };
  });

  const updated = await updateProject(projectId, { scenes });
  if (patch.motionPrompt !== undefined) {
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (scene && patch.motionPrompt !== scene.motionPrompt) {
      await markTimelineNeedsRebuild(projectId);
    }
  }
  return updated;
}

export async function registerSceneImageAsset(projectId, sceneId, assetId) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} não encontrado`);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Cena ${sceneId} não encontrada`);

  const imageChanged = scene.imageAssetId && scene.imageAssetId !== assetId;
  const imageVersions = [...new Set([...(scene.imageVersions || []), assetId])];

  await updateProjectScene(projectId, sceneId, {
    imageAssetId: assetId,
    imageVersions,
    status: imageChanged
      ? statusAfterImageChange(scene, Boolean(project.latestExport))
      : { ...scene.status, image: "done" },
  });

  if (imageChanged && (scene.videoAssetId || project.latestExport)) {
    await markTimelineNeedsRebuild(projectId);
  }
  return getProject(projectId);
}

export async function registerSceneVideoAsset(projectId, sceneId, assetId) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} não encontrado`);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Cena ${sceneId} não encontrada`);

  const videoVersions = [...new Set([...(scene.videoVersions || []), assetId])];

  await updateProjectScene(projectId, sceneId, {
    videoAssetId: assetId,
    videoVersions,
    status: statusAfterVideoChange(scene, Boolean(project.latestExport)),
  });

  await markTimelineNeedsRebuild(projectId);
  return getProject(projectId);
}

export async function activateSceneAssetVersion(projectId, sceneId, type, assetId) {
  const project = await getProject(projectId);
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Cena ${sceneId} não encontrada`);

  const versions = type === "image" ? scene.imageVersions : scene.videoVersions;
  if (!versions?.includes(assetId)) {
    throw new Error("Versão não encontrada nesta cena.");
  }

  if (type === "image") return registerSceneImageAsset(projectId, sceneId, assetId);
  return registerSceneVideoAsset(projectId, sceneId, assetId);
}

export async function getProjectScene(projectId, sceneId) {
  const project = await getProject(projectId);
  const scene = project?.scenes?.find((s) => s.id === sceneId);
  if (!scene) return null;
  return { project, scene };
}

/** @deprecated use registerSceneImageAsset */
export async function linkAssetToScene(projectId, sceneId, assetId) {
  return registerSceneImageAsset(projectId, sceneId, assetId);
}

/** @deprecated use registerSceneVideoAsset */
export async function linkVideoAssetToScene(projectId, sceneId, assetId) {
  return registerSceneVideoAsset(projectId, sceneId, assetId);
}

export async function setProjectExport(projectId, { assetId, jobId, finalVideo }) {
  const project = await getProject(projectId);
  const scenes = (project?.scenes || []).map((s) => ({
    ...s,
    status: {
      ...s.status,
      final: "done",
      video: s.videoAssetId ? "done" : s.status?.video || "pending",
      image: s.imageAssetId ? "done" : s.status?.image || "pending",
    },
  }));

  return updateProject(projectId, {
    timelineStatus: "ready",
    scenes,
    latestExport: {
      assetId,
      jobId,
      finalVideo,
      rebuiltAt: new Date().toISOString(),
    },
  });
}

export async function markTimelineNeedsRebuild(projectId) {
  const project = await getProject(projectId);
  if (!project?.latestExport) {
    return updateProject(projectId, { timelineStatus: "needs_rebuild" });
  }
  return updateProject(projectId, { timelineStatus: "needs_rebuild" });
}

export async function addProjectAssetId(projectId, assetId) {
  const project = await getProject(projectId);
  if (!project) return null;
  const assetIds = project.assetIds.includes(assetId)
    ? project.assetIds
    : [...project.assetIds, assetId];
  return updateProject(projectId, { assetIds });
}

export async function createProject(payload = {}) {
  await ensureProjectsDir();
  const now = new Date().toISOString();
  const project = {
    id: randomUUID(),
    name: String(payload.name || "Untitled Project").trim() || "Untitled Project",
    masterPrompt: String(payload.masterPrompt || "").trim(),
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...payload.settings },
    jobIds: [],
    creatives: [],
    latestCreative: null,
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(projectPath(project.id), JSON.stringify(project, null, 2));
  return project;
}

export async function getProject(id) {
  try {
    const raw = await fs.readFile(projectPath(id), "utf8");
    return normalizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function updateProject(id, patch = {}) {
  const project = await getProject(id);
  if (!project) throw new Error(`Project ${id} não encontrado`);

  const next = {
    ...project,
    ...patch,
    settings: patch.settings
      ? { ...project.settings, ...patch.settings }
      : project.settings,
    jobIds: patch.jobIds ?? project.jobIds,
    creatives: patch.creatives ?? project.creatives,
    latestCreative: patch.latestCreative ?? project.latestCreative,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(projectPath(id), JSON.stringify(next, null, 2));
  return next;
}

export async function deleteProject(id) {
  try {
    await fs.unlink(projectPath(id));
    return true;
  } catch {
    return false;
  }
}

export async function duplicateProject(id) {
  const source = await getProject(id);
  if (!source) return null;

  const copy = await createProject({
    name: `${source.name} (cópia)`,
    masterPrompt: source.masterPrompt,
    settings: { ...source.settings },
  });
  return copy;
}

export async function listProjects(limit = 100) {
  await ensureProjectsDir();
  const files = await fs.readdir(PROJECTS_DIR);
  const projects = [];

  for (const file of files.filter((f) => f.endsWith(".json")).slice(-limit)) {
    try {
      const raw = await fs.readFile(path.join(PROJECTS_DIR, file), "utf8");
      projects.push(normalizeProject(JSON.parse(raw)));
    } catch {
      /* skip corrupt */
    }
  }

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function linkJobToProject(projectId, jobId, creativeMeta = {}) {
  const project = await getProject(projectId);
  if (!project) return null;

  const jobIds = project.jobIds.includes(jobId)
    ? project.jobIds
    : [...project.jobIds, jobId];

  const creative = {
    jobId,
    ...creativeMeta,
    linkedAt: new Date().toISOString(),
  };

  return updateProject(projectId, {
    jobIds,
    latestCreative: creative,
    creatives: [...project.creatives, creative],
  });
}
