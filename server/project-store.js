import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  emptyCreative,
  migrateCreatives,
  mirrorProjectFromCreative,
  resolveCreative,
} from "./creative-store.js";
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

function normalizeScenes(scenes, hasExport = false) {
  return (scenes || []).map((s) => normalizeScene(s, hasExport));
}

function normalizeProject(raw) {
  const creatives = migrateCreatives(raw);
  const activeCreativeId =
    raw.activeCreativeId || creatives[creatives.length - 1]?.id || null;

  const base = {
    ...raw,
    startingPoint: raw.startingPoint || "prompt",
    entryPrompt: raw.entryPrompt || "",
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...raw.settings },
    jobIds: raw.jobIds || [],
    creatives: creatives.map((c) => ({
      ...c,
      scenes: normalizeScenes(c.scenes, Boolean(c.latestExport)),
    })),
    activeCreativeId,
    assetIds: raw.assetIds || [],
    avatar: raw.avatar || null,
    referenceAssetIds: raw.referenceAssetIds || [],
  };

  return mirrorProjectFromCreative(base);
}

function serializeProject(project) {
  return {
    id: project.id,
    name: project.name,
    masterPrompt: project.masterPrompt,
    startingPoint: project.startingPoint || "prompt",
    entryPrompt: project.entryPrompt || "",
    settings: project.settings,
    jobIds: project.jobIds,
    creatives: project.creatives,
    activeCreativeId: project.activeCreativeId,
    avatar: project.avatar,
    referenceAssetIds: project.referenceAssetIds,
    assetIds: project.assetIds,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
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

export async function setProjectCopy(projectId, copy, copyPath = null, creativeId = null) {
  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;
  if (!cid) throw new Error("Nenhum vídeo activo — cria um vídeo primeiro.");

  return updateCreative(projectId, cid, {
    copy: {
      ...copy,
      copyPath,
      savedAt: new Date().toISOString(),
    },
  });
}

export async function applyBlueprint(
  projectId,
  { storyboardPath, storyboard, creativeId = null },
) {
  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;
  if (!cid) throw new Error("Nenhum vídeo activo — cria um vídeo primeiro.");

  const sceneCount = storyboard.scenes?.length || 0;
  const clipDuration =
    storyboard.clipDurationSeconds ||
    storyboard.config?.clipDurationSeconds ||
    storyboard.durationSeconds ||
    8;

  const blueprint = {
    title: storyboard.title,
    hook: storyboard.hook,
    sceneCount,
    clipDurationSeconds: clipDuration,
    totalDurationSeconds: storyboard.totalDurationSeconds || sceneCount * clipDuration,
  };

  await updateCreative(projectId, cid, {
    title: storyboard.title || resolveCreative(project, cid)?.title,
    blueprintPath: storyboardPath,
    blueprint,
    scenes: storyboardToScenes(storyboard),
    timelineStatus: "pending",
    latestExport: null,
  });

  return updateProject(projectId, {
    settings: {
      sceneCount,
      clipDurationSeconds: clipDuration,
      totalDurationSeconds: storyboard.totalDurationSeconds || sceneCount * clipDuration,
    },
  });
}

export async function updateProjectScene(projectId, sceneId, patch, creativeId = null) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} não encontrado`);
  const cid = creativeId || project.activeCreativeId;
  const creative = resolveCreative(project, cid);
  if (!creative) throw new Error("Nenhum vídeo activo.");

  const scenes = creative.scenes.map((s) => {
    if (s.id !== sceneId) return s;

    let status = s.status;
    if (patch.motionPrompt !== undefined && patch.motionPrompt !== s.motionPrompt) {
      status = statusAfterMotionPromptChange(s, Boolean(creative.latestExport));
    }
    if (patch.status) {
      status = { ...status, ...patch.status };
    }

    const { status: _ignored, ...restPatch } = patch;
    return { ...s, ...restPatch, status };
  });

  await updateCreative(projectId, cid, { scenes });
  if (patch.motionPrompt !== undefined) {
    const scene = creative.scenes.find((s) => s.id === sceneId);
    if (scene && patch.motionPrompt !== scene.motionPrompt) {
      await markTimelineNeedsRebuild(projectId, cid);
    }
  }
  return getProject(projectId);
}

export async function registerSceneImageAsset(
  projectId,
  sceneId,
  assetId,
  creativeId = null,
) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} não encontrado`);
  const creative = resolveCreative(project, creativeId);
  const scene = creative?.scenes?.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Cena ${sceneId} não encontrada`);

  const imageChanged = scene.imageAssetId && scene.imageAssetId !== assetId;
  const imageVersions = [...new Set([...(scene.imageVersions || []), assetId])];

  await updateProjectScene(
    projectId,
    sceneId,
    {
      imageAssetId: assetId,
      imageVersions,
      status: imageChanged
        ? statusAfterImageChange(scene, Boolean(creative.latestExport))
        : { ...scene.status, image: "done" },
    },
    creative?.id,
  );

  if (imageChanged && (scene.videoAssetId || creative.latestExport)) {
    await markTimelineNeedsRebuild(projectId, creative.id);
  }
  return getProject(projectId);
}

export async function registerSceneVideoAsset(
  projectId,
  sceneId,
  assetId,
  creativeId = null,
) {
  const project = await getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} não encontrado`);
  const creative = resolveCreative(project, creativeId);
  const scene = creative?.scenes?.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`Cena ${sceneId} não encontrada`);

  const videoVersions = [...new Set([...(scene.videoVersions || []), assetId])];

  await updateProjectScene(
    projectId,
    sceneId,
    {
      videoAssetId: assetId,
      videoVersions,
      status: statusAfterVideoChange(scene, Boolean(creative.latestExport)),
    },
    creative?.id,
  );

  await markTimelineNeedsRebuild(projectId, creative.id);
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

export async function getProjectScene(projectId, sceneId, creativeId = null) {
  const project = await getProject(projectId);
  const creative = resolveCreative(project, creativeId);
  const scene = creative?.scenes?.find((s) => s.id === sceneId);
  if (!scene) return null;
  return { project: mirrorProjectFromCreative({ ...project, activeCreativeId: creative.id }), scene };
}

export async function linkAssetToScene(projectId, sceneId, assetId) {
  return registerSceneImageAsset(projectId, sceneId, assetId);
}

export async function linkVideoAssetToScene(projectId, sceneId, assetId) {
  return registerSceneVideoAsset(projectId, sceneId, assetId);
}

export async function setProjectExport(
  projectId,
  { assetId, jobId, finalVideo },
  creativeId = null,
) {
  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;
  const creative = resolveCreative(project, cid);
  if (!creative) throw new Error("Nenhum vídeo activo.");

  const scenes = creative.scenes.map((s) => ({
    ...s,
    status: {
      ...s.status,
      final: "done",
      video: s.videoAssetId ? "done" : s.status?.video || "pending",
      image: s.imageAssetId ? "done" : s.status?.image || "pending",
    },
  }));

  return updateCreative(projectId, cid, {
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

export async function markTimelineNeedsRebuild(projectId, creativeId = null) {
  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;
  return updateCreative(projectId, cid, { timelineStatus: "needs_rebuild" });
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
    startingPoint: payload.startingPoint || "prompt",
    entryPrompt: String(payload.entryPrompt || "").trim(),
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...payload.settings },
    jobIds: [],
    creatives: [],
    activeCreativeId: null,
    avatar: null,
    referenceAssetIds: [],
    assetIds: [],
    createdAt: now,
    updatedAt: now,
  };
  await fs.writeFile(projectPath(project.id), JSON.stringify(project, null, 2));
  return normalizeProject(project);
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

  let creatives = patch.creatives ?? project.creatives;
  let activeCreativeId = patch.activeCreativeId ?? project.activeCreativeId;

  const legacyCreativePatch = {};
  if (patch.scenes !== undefined) legacyCreativePatch.scenes = patch.scenes;
  if (patch.blueprintPath !== undefined) legacyCreativePatch.blueprintPath = patch.blueprintPath;
  if (patch.blueprint !== undefined) legacyCreativePatch.blueprint = patch.blueprint;
  if (patch.latestExport !== undefined) legacyCreativePatch.latestExport = patch.latestExport;
  if (patch.timelineStatus !== undefined) legacyCreativePatch.timelineStatus = patch.timelineStatus;
  if (patch.latestCopy !== undefined) legacyCreativePatch.copy = patch.latestCopy;

  if (Object.keys(legacyCreativePatch).length && activeCreativeId) {
    creatives = creatives.map((c) =>
      c.id === activeCreativeId
        ? { ...c, ...legacyCreativePatch, updatedAt: new Date().toISOString() }
        : c,
    );
  }

  const next = serializeProject({
    ...project,
    ...patch,
    settings: patch.settings ? { ...project.settings, ...patch.settings } : project.settings,
    jobIds: patch.jobIds ?? project.jobIds,
    creatives,
    activeCreativeId,
    avatar: patch.avatar ?? project.avatar,
    referenceAssetIds: patch.referenceAssetIds ?? project.referenceAssetIds,
    assetIds: patch.assetIds ?? project.assetIds,
    updatedAt: new Date().toISOString(),
  });

  await fs.writeFile(projectPath(id), JSON.stringify(next, null, 2));
  return normalizeProject(next);
}

export async function updateCreative(projectId, creativeId, patch) {
  const project = await getProject(projectId);
  const cid = creativeId || project.activeCreativeId;
  if (!cid) throw new Error("Nenhum vídeo activo.");

  const creatives = project.creatives.map((c) => {
    if (c.id !== cid) return c;
    return { ...c, ...patch, updatedAt: new Date().toISOString() };
  });

  return updateProject(projectId, { creatives, activeCreativeId: cid });
}

export async function createCreative(projectId, { title } = {}) {
  const project = await getProject(projectId);
  if (!project) throw new Error("Projecto não encontrado");
  const creative = emptyCreative({
    title: title || `Vídeo ${project.creatives.length + 1}`,
    index: project.creatives.length + 1,
  });
  return updateProject(projectId, {
    creatives: [...project.creatives, creative],
    activeCreativeId: creative.id,
  });
}

export async function setActiveCreative(projectId, creativeId) {
  const project = await getProject(projectId);
  if (!project.creatives.some((c) => c.id === creativeId)) {
    throw new Error("Vídeo não encontrado neste projecto.");
  }
  return updateProject(projectId, { activeCreativeId: creativeId });
}

export async function ensureActiveCreative(projectId, { title } = {}) {
  const project = await getProject(projectId);
  if (resolveCreative(project)) return project;
  return createCreative(projectId, { title });
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

export async function linkJobToProject(projectId, jobId, creativeMeta = {}, creativeId = null) {
  const project = await getProject(projectId);
  if (!project) return null;

  const cid = creativeId || project.activeCreativeId;
  const jobIds = project.jobIds.includes(jobId) ? project.jobIds : [...project.jobIds, jobId];

  const creatives = project.creatives.map((c) => {
    if (c.id !== cid) return c;
    const cJobIds = c.jobIds?.includes(jobId) ? c.jobIds : [...(c.jobIds || []), jobId];
    return {
      ...c,
      jobIds: cJobIds,
      ...creativeMeta,
      updatedAt: new Date().toISOString(),
    };
  });

  return updateProject(projectId, { jobIds, creatives });
}
