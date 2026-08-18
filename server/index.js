import "dotenv/config";
import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  AD_ASPECT_RATIOS,
  AD_CLIP_DURATIONS,
  AD_LANGUAGES,
  AD_RESOLUTIONS,
  AD_STYLES,
  AD_TONES,
  LANGUAGE_VARIANTS,
  MAX_SCENE_COUNT,
  MAX_TOTAL_DURATION_SECONDS,
  MIN_SCENE_COUNT,
} from "../src/lib/ad-config.js";
import { createJob, getJob, listJobs, listPendingJobs, resetStaleRunningJobs, safeUpdateJob, updateJob } from "./job-store.js";
import {
  createAsset,
  deleteAsset,
  getAsset,
  listAssetsByProject,
  resolveAssetFile,
} from "./asset-store.js";
import {
  activateSceneAssetVersion,
  addProjectAssetId,
  createCreative,
  createProject,
  deleteProject,
  duplicateProject,
  ensureActiveCreative,
  getProject,
  getProjectScene,
  linkAssetToScene,
  listProjects,
  setActiveCreative,
  updateProject,
  updateProjectScene,
} from "./project-store.js";
import { listCreativeSummaries, resolveCreative } from "./creative-store.js";
import { persistJobFailed, persistJobProgress, runJob } from "./workers.js";
import { pickAdOverrides } from "./ad-overrides.js";
import { buildTimelineView } from "./timeline.js";
import { buildExportView } from "./exports.js";
import { syncGenerationAssetsToProject } from "./project-sync.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resolveJobCreativeId(project, req) {
  if (req.body?.creativeId) return req.body.creativeId;
  if (project.activeCreativeId) return project.activeCreativeId;
  const updated = await ensureActiveCreative(project.id);
  return updated.activeCreativeId;
}

function activeCreativeHasBlueprint(project) {
  const creative = resolveCreative(project);
  return Boolean(creative?.blueprintPath);
}
const ROOT = path.resolve(__dirname, "..");
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

let activeJobId = null;
const queue = [];
const STALE_JOB_MS = Number.parseInt(process.env.JOB_STALE_MS || "180000", 10); // 3 min sem progresso

const app = express();
app.use(
  cors({
    origin: FRONTEND_URL === "*" ? true : FRONTEND_URL.split(",").map((s) => s.trim()),
  }),
);
app.use(express.json({ limit: "8mb" }));

const enqueue = (id) => {
  queue.push(id);
  processQueue();
};

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ecoom-direct-ads-api",
    activeJobId,
    queueLength: queue.length,
  });
});

app.get("/api/queue/status", (_req, res) => {
  res.json({ activeJobId, queueLength: queue.length, queuedIds: [...queue] });
});

/** Libertar fila quando job ficou preso (sem progresso). */
app.post("/api/queue/reset", async (_req, res) => {
  const stuckId = activeJobId;
  if (stuckId) {
    await safeUpdateJob(stuckId, {
      status: "failed",
      error: "Job cancelado — estava bloqueado. Tenta Images → Videos passo a passo.",
      progress: { step: "error", message: "Job libertado manualmente" },
    });
    activeJobId = null;
  }
  processQueue();
  res.json({ ok: true, clearedJobId: stuckId || null, queueLength: queue.length });
});

app.get("/api/config", (_req, res) => {
  res.json({
    languages: AD_LANGUAGES,
    languageVariants: LANGUAGE_VARIANTS,
    aspectRatios: AD_ASPECT_RATIOS,
    clipDurations: AD_CLIP_DURATIONS,
    sceneCountRange: { min: MIN_SCENE_COUNT, max: MAX_SCENE_COUNT },
    maxTotalDurationSeconds: MAX_TOTAL_DURATION_SECONDS,
    resolutions: AD_RESOLUTIONS,
    tones: AD_TONES,
    styles: AD_STYLES,
    features: {
      projects: true,
      assets: true,
      videos: true,
      timeline: true,
      sceneEditor: true,
      export: true,
      liveProgress: true,
      briefWizard: true,
      maxSceneCount: MAX_SCENE_COUNT,
    },
  });
});

app.get("/api/projects", async (_req, res) => {
  const projects = await listProjects();
  res.json({ projects });
});

app.post("/api/projects", async (req, res) => {
  const { name, masterPrompt, settings, startingPoint, entryPrompt } = req.body || {};
  const project = await createProject({
    name,
    masterPrompt,
    settings,
    startingPoint,
    entryPrompt,
  });
  res.status(201).json(project);
});

app.get("/api/projects/:id", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  res.json(project);
});

app.patch("/api/projects/:id", async (req, res) => {
  try {
    const project = await updateProject(req.params.id, req.body || {});
    res.json(project);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  const ok = await deleteProject(req.params.id);
  if (!ok) return res.status(404).json({ error: "Projecto não encontrado" });
  res.status(204).end();
});

app.post("/api/projects/:id/duplicate", async (req, res) => {
  const copy = await duplicateProject(req.params.id);
  if (!copy) return res.status(404).json({ error: "Projecto não encontrado" });
  res.status(201).json(copy);
});

app.get("/api/projects/:id/storyboard", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const creative = resolveCreative(project, req.query?.creativeId);
  const storyboardPath = creative?.blueprintPath;

  if (!storyboardPath || !fs.existsSync(storyboardPath)) {
    return res.status(404).json({ error: "Storyboard ainda não disponível" });
  }

  const raw = fs.readFileSync(storyboardPath, "utf8");
  res.json(JSON.parse(raw));
});

app.get("/api/projects/:id/creatives", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  const assets = await listAssetsByProject(req.params.id);
  const assetById = Object.fromEntries(assets.map((a) => [a.id, a]));
  res.json({
    activeCreativeId: project.activeCreativeId,
    creatives: listCreativeSummaries(project, assetById),
  });
});

app.post("/api/projects/:id/creatives", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  const title = req.body?.title?.trim() || `Vídeo ${project.creatives.length + 1}`;
  const updated = await createCreative(req.params.id, { title });
  res.status(201).json({
    creativeId: updated.activeCreativeId,
    creatives: listCreativeSummaries(updated),
  });
});

app.post("/api/projects/:id/creatives/:creativeId/activate", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  const updated = await setActiveCreative(req.params.id, req.params.creativeId);
  res.json({ activeCreativeId: updated.activeCreativeId, project: updated });
});

app.get("/api/projects/:id/assets", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  const assets = await listAssetsByProject(req.params.id);
  res.json({
    assets,
    scenes: project.scenes || [],
    activeCreativeId: project.activeCreativeId,
  });
});

app.post("/api/projects/:id/assets", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const { data, filename, sceneId, mimeType, role, label } = req.body || {};
  if (!data) return res.status(400).json({ error: "Campo 'data' (base64) obrigatório" });

  const buffer = Buffer.from(data, "base64");
  const name = filename || "upload.png";
  const isVideo =
    role === "video" ||
    mimeType?.startsWith("video/") ||
    /\.(mp4|mov|webm|m4v)$/i.test(name);
  const maxBytes = isVideo ? 80 * 1024 * 1024 : 6 * 1024 * 1024;
  if (buffer.length > maxBytes) {
    return res.status(400).json({
      error: isVideo
        ? "Vídeo demasiado grande (max 80MB)"
        : "Imagem demasiado grande (max 6MB)",
    });
  }

  const ext = name.split(".").pop() || (isVideo ? "mp4" : "png");
  const isReference = role === "reference";
  const asset = await createAsset({
    projectId: req.params.id,
    sceneId: sceneId || null,
    type: isVideo ? "video" : "image",
    source: isReference ? "reference" : "upload",
    prompt: label || name || (isReference ? "referência" : "upload"),
    fileBuffer: buffer,
    ext,
    metadata: {
      mimeType: mimeType || (isVideo ? "video/mp4" : "image/png"),
      originalName: name,
      role: isReference ? "reference" : isVideo ? "video" : "scene",
      label: label || name || "",
    },
  });

  await addProjectAssetId(req.params.id, asset.id);
  if (sceneId) await linkAssetToScene(req.params.id, sceneId, asset.id);
  if (isReference) {
    const refs = [...new Set([...(project.referenceAssetIds || []), asset.id])];
    await updateProject(req.params.id, { referenceAssetIds: refs });
  }

  res.status(201).json(asset);
});

app.get("/api/assets/:id/file", async (req, res) => {
  const asset = await getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "Asset não encontrado" });
  if (!fs.existsSync(asset.filePath)) {
    return res.status(404).json({ error: "Ficheiro não encontrado" });
  }
  res.sendFile(resolveAssetFile(asset));
});

app.delete("/api/assets/:id", async (req, res) => {
  const ok = await deleteAsset(req.params.id);
  if (!ok) return res.status(404).json({ error: "Asset não encontrado" });
  res.status(204).end();
});

app.post("/api/projects/:id/assets/:assetId/variations", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const source = await getAsset(req.params.assetId);
  if (!source || source.projectId !== req.params.id) {
    return res.status(404).json({ error: "Asset não encontrado neste projecto" });
  }
  if (source.type !== "image") {
    return res.status(400).json({ error: "Variações só a partir de imagens" });
  }

  const count = Math.min(Math.max(1, Number(req.body?.count) || 5), 12);
  const prompt = String(req.body?.prompt || "").trim();
  const id = randomUUID().slice(0, 8);

  await createJob({
    id,
    type: "variations",
    request: {
      type: "variations",
      projectId: req.params.id,
      sourceAssetId: req.params.assetId,
      count,
      prompt,
    },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "variations", count });
});

app.post("/api/projects/:id/assets/generate-image", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt obrigatório" });
  const count = Math.min(Math.max(1, Number(req.body?.count) || 1), 12);
  const id = randomUUID().slice(0, 8);

  await createJob({
    id,
    type: "standalone_image",
    request: { type: "standalone_image", projectId: req.params.id, prompt, count },
  });
  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "standalone_image", count });
});

app.post("/api/projects/:id/assets/generate-video", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "Prompt obrigatório" });
  const id = randomUUID().slice(0, 8);

  await createJob({
    id,
    type: "standalone_video",
    request: { type: "standalone_video", projectId: req.params.id, prompt },
  });
  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "standalone_video" });
});

app.post("/api/projects/:id/assets/:assetId/animate", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const source = await getAsset(req.params.assetId);
  if (!source || source.projectId !== req.params.id) {
    return res.status(404).json({ error: "Asset não encontrado neste projecto" });
  }
  if (source.type !== "image") {
    return res.status(400).json({ error: "Animar só a partir de imagens" });
  }

  const prompt = String(req.body?.prompt || "").trim();
  const lastFrameAssetId = String(req.body?.lastFrameAssetId || "").trim() || null;
  const id = randomUUID().slice(0, 8);

  await createJob({
    id,
    type: "asset_video",
    request: {
      type: "asset_video",
      projectId: req.params.id,
      sourceAssetId: req.params.assetId,
      lastFrameAssetId,
      prompt,
    },
  });
  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "asset_video" });
});

app.get("/api/characters", async (_req, res) => {
  const projects = await listProjects();
  const characters = [];

  for (const project of projects) {
    if (project.avatar?.anchorImageAssetId) {
      characters.push({
        id: `${project.id}-${project.avatar.anchorImageAssetId}`,
        projectId: project.id,
        projectName: project.name,
        assetId: project.avatar.anchorImageAssetId,
        characterBrief: project.avatar.characterBrief || "",
        settingBrief: project.avatar.settingBrief || "",
        source: "avatar",
      });
    }
    const assets = await listAssetsByProject(project.id);
    for (const asset of assets) {
      if (asset.metadata?.role === "character" && asset.type === "image") {
        if (project.avatar?.anchorImageAssetId === asset.id) continue;
        characters.push({
          id: `${project.id}-${asset.id}`,
          projectId: project.id,
          projectName: project.name,
          assetId: asset.id,
          characterBrief: asset.prompt || asset.metadata?.label || "",
          settingBrief: "",
          source: "asset",
        });
      }
    }
  }

  res.json({ characters });
});

app.post("/api/projects/:id/avatar", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const { assetId, characterBrief, settingBrief } = req.body || {};
  if (!assetId) return res.status(400).json({ error: "assetId obrigatório" });

  const asset = await getAsset(assetId);
  if (!asset || asset.projectId !== req.params.id) {
    return res.status(404).json({ error: "Asset não encontrado neste projecto" });
  }
  if (asset.type !== "image") {
    return res.status(400).json({ error: "Avatar tem de ser uma imagem" });
  }

  const updated = await updateProject(req.params.id, {
    avatar: {
      anchorImageAssetId: assetId,
      characterBrief: String(characterBrief || asset.prompt || "").trim(),
      settingBrief: String(settingBrief || "").trim(),
    },
  });

  res.json(updated);
});

app.post("/api/projects/:id/references", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const { assetId } = req.body || {};
  if (!assetId) return res.status(400).json({ error: "assetId obrigatório" });

  const asset = await getAsset(assetId);
  if (!asset || asset.projectId !== req.params.id) {
    return res.status(404).json({ error: "Asset não encontrado neste projecto" });
  }

  const refs = [...new Set([...(project.referenceAssetIds || []), assetId])];
  const updated = await updateProject(req.params.id, { referenceAssetIds: refs });
  res.json(updated);
});

app.post("/api/projects/:id/blueprint", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const offer = (req.body?.offer || project.masterPrompt || "").trim();
  if (!offer) return res.status(400).json({ error: "Master prompt em falta" });

  const overrides = { ...project.settings, ...req.body?.overrides };
  const wizard = req.body?.wizard || {};
  const approvedCopy = req.body?.approvedCopy || null;
  const creativeId = await resolveJobCreativeId(project, req);
  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "blueprint",
    request: {
      type: "blueprint",
      offer,
      overrides,
      wizard,
      approvedCopy,
      projectId: req.params.id,
      creativeId,
    },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "blueprint" });
});

app.post("/api/projects/:id/copy", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const offer = (req.body?.offer || project.masterPrompt || "").trim();
  if (!offer) return res.status(400).json({ error: "Brief em falta" });

  const overrides = { ...project.settings, ...req.body?.overrides };
  const wizard = req.body?.wizard || {};
  const creativeId = await resolveJobCreativeId(project, req);
  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "copy",
    request: {
      type: "copy",
      offer,
      overrides,
      wizard,
      projectId: req.params.id,
      creativeId,
    },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "copy" });
});

app.post("/api/projects/:id/images/generate", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  if (!activeCreativeHasBlueprint(project)) {
    return res.status(400).json({ error: "Gera o blueprint primeiro" });
  }

  const creativeId = project.activeCreativeId;
  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "images",
    request: { type: "images", projectId: req.params.id, overrides: project.settings, creativeId },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "images" });
});

app.post("/api/projects/:id/scenes/:sceneId/image", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const creativeId = await resolveJobCreativeId(project, req);
  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "scene_image",
    request: {
      type: "scene_image",
      projectId: req.params.id,
      sceneId: req.params.sceneId,
      creativeId,
    },
  });

  enqueue(id);
  res.status(202).json({
    jobId: id,
    status: "queued",
    type: "scene_image",
    sceneId: req.params.sceneId,
  });
});

app.post("/api/projects/:id/videos/generate", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const scenes = project.scenes || [];
  if (!scenes.length) {
    return res.status(400).json({ error: "Gera blueprint e imagens primeiro" });
  }

  const creativeId = project.activeCreativeId;
  const autoRebuild = req.body?.autoRebuild !== false;
  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "videos",
    request: {
      type: "videos",
      projectId: req.params.id,
      creativeId,
      autoRebuild,
    },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "videos", sceneCount: scenes.length });
});

app.post("/api/projects/:id/scenes/:sceneId/video", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "scene_video",
    request: {
      type: "scene_video",
      projectId: req.params.id,
      sceneId: req.params.sceneId,
      motionPrompt: req.body?.motionPrompt || null,
    },
  });

  enqueue(id);
  res.status(202).json({
    jobId: id,
    status: "queued",
    type: "scene_video",
    sceneId: req.params.sceneId,
  });
});

app.get("/api/projects/:id/scenes/:sceneId", async (req, res) => {
  const data = await getProjectScene(req.params.id, req.params.sceneId);
  if (!data) return res.status(404).json({ error: "Cena não encontrada" });

  const { project, scene } = data;
  const assets = await listAssetsByProject(req.params.id);
  const assetById = Object.fromEntries(assets.map((a) => [a.id, a]));

  const mapVersions = (ids, activeId) =>
    (ids || []).map((assetId, index) => {
      const asset = assetById[assetId];
      return {
        assetId,
        label: `V${index + 1}`,
        active: assetId === activeId,
        prompt: asset?.prompt || "",
        source: asset?.source || "",
        createdAt: asset?.createdAt || null,
      };
    });

  res.json({
    scene: {
      id: scene.id,
      order: scene.order,
      role: scene.role,
      imagePrompt: scene.imagePrompt,
      motionPrompt: scene.motionPrompt,
      voiceoverLine: scene.voiceoverLine,
      imageAssetId: scene.imageAssetId,
      videoAssetId: scene.videoAssetId,
      status: scene.status || {},
    },
    versions: {
      image: mapVersions(scene.imageVersions, scene.imageAssetId),
      video: mapVersions(scene.videoVersions, scene.videoAssetId),
    },
    timelineStatus: buildTimelineView(project).timelineStatus,
  });
});

app.patch("/api/projects/:id/scenes/:sceneId", async (req, res) => {
  try {
    const patch = {};
    if (req.body?.motionPrompt !== undefined) {
      patch.motionPrompt = String(req.body.motionPrompt || "").trim();
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: "Nada para actualizar" });
    }
    const project = await updateProjectScene(req.params.id, req.params.sceneId, patch);
    const scene = project.scenes.find((s) => s.id === req.params.sceneId);
    res.json({ scene, timelineStatus: buildTimelineView(project).timelineStatus });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post("/api/projects/:id/scenes/:sceneId/versions/activate", async (req, res) => {
  try {
    const { type, assetId } = req.body || {};
    if (!["image", "video"].includes(type)) {
      return res.status(400).json({ error: "type deve ser 'image' ou 'video'" });
    }
    if (!assetId) return res.status(400).json({ error: "assetId obrigatório" });

    const project = await activateSceneAssetVersion(
      req.params.id,
      req.params.sceneId,
      type,
      assetId,
    );
    const scene = project.scenes.find((s) => s.id === req.params.sceneId);
    res.json({ scene, timelineStatus: buildTimelineView(project).timelineStatus });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/projects/:id/timeline", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  res.json(buildTimelineView(project));
});

app.get("/api/projects/:id/exports", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  const assets = await listAssetsByProject(req.params.id);
  res.json(await buildExportView(project, assets));
});

app.post("/api/projects/:id/timeline/rebuild", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const view = buildTimelineView(project);
  if (!view.allVideosReady) {
    return res.status(400).json({ error: "Todos os clips devem estar prontos (Animate All)." });
  }

  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "rebuild",
    request: { type: "rebuild", projectId: req.params.id, creativeId: project.activeCreativeId },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "rebuild" });
});

/** Recupera imagens/clips/export de um job full_ad já concluído */
app.post("/api/projects/:id/sync-job/:jobId", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const job = await getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job não encontrado" });
  if (job.status !== "completed") {
    return res.status(400).json({ error: "Job ainda não concluído." });
  }

  try {
    const sync = await syncGenerationAssetsToProject(
      req.params.id,
      req.params.jobId,
      { ...job.result, runId: job.result?.runId || req.params.jobId },
    );
    res.json({ ok: true, ...sync });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/jobs", async (_req, res) => {
  const jobs = await listJobs();
  res.json({ jobs });
});

app.get("/api/jobs/:id", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job não encontrado" });
  res.json(job);
});

app.get("/api/jobs/:id/video", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job?.result?.finalVideo) {
    return res.status(404).json({ error: "Vídeo ainda não disponível" });
  }
  const videoPath = job.result.finalVideo;
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: "Ficheiro de vídeo não encontrado no servidor" });
  }
  res.sendFile(path.resolve(videoPath));
});

app.get("/api/jobs/:id/copy", async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job?.result?.copy) {
    return res.status(404).json({ error: "Copy ainda não disponível" });
  }
  res.json(job.result.copy);
});

app.post("/api/jobs", async (req, res) => {
  const {
    offer,
    projectId,
    wizard,
    approvedCopy,
    creativeId: bodyCreativeId,
    ...rawOverrides
  } = req.body || {};
  if (!offer?.trim()) {
    return res.status(400).json({ error: "Campo 'offer' (brief) é obrigatório." });
  }

  let creativeId = bodyCreativeId || null;

  if (projectId) {
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: "Projecto não encontrado" });
    }
  }

  if (projectId) {
    await ensureActiveCreative(projectId);
    const fresh = await getProject(projectId);
    creativeId = creativeId || fresh.activeCreativeId;
  }

  const overrides = pickAdOverrides(rawOverrides);
  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "full_ad",
    request: {
      type: "full_ad",
      offer: offer.trim(),
      overrides,
      wizard: wizard || null,
      approvedCopy: approvedCopy || null,
      projectId: projectId || null,
      creativeId: creativeId || null,
    },
  });

  enqueue(id);

  res.status(202).json({ jobId: id, status: "queued", queueLength: queue.length, projectId });
});

/** Vários briefs de uma vez — processa em fila automática */
app.post("/api/jobs/batch", async (req, res) => {
  const { offers, overrides = {} } = req.body || {};
  if (!Array.isArray(offers) || offers.length === 0) {
    return res.status(400).json({ error: "Envia array 'offers' com pelo menos 1 brief." });
  }
  if (offers.length > 20) {
    return res.status(400).json({ error: "Máximo 20 ads por batch." });
  }

  const jobIds = [];
  for (const raw of offers) {
    const offer = String(raw || "").trim();
    if (!offer) continue;
    const id = randomUUID().slice(0, 8);
    await createJob({ id, request: { offer, overrides } });
    queue.push(id);
    jobIds.push(id);
  }

  if (jobIds.length === 0) {
    return res.status(400).json({ error: "Nenhum brief válido no array." });
  }

  processQueue();
  res.status(202).json({
    jobIds,
    count: jobIds.length,
    status: "queued",
    queueLength: queue.length,
  });
});

async function processQueue() {
  if (activeJobId || queue.length === 0) return;

  const jobId = queue.shift();
  activeJobId = jobId;

  try {
    const job = await getJob(jobId);
    if (!job) {
      console.error(`[queue] Job ${jobId} em falta no disco — ignorado`);
      return;
    }

    await updateJob(jobId, {
      status: "running",
      progress: { step: "starting", message: "A iniciar..." },
    });

    const result = await runJob(job, async (update) => {
      await persistJobProgress(jobId, update);
    });

    await updateJob(jobId, {
      status: "completed",
      progress: { step: "done", message: "Concluído" },
      result,
    });
  } catch (err) {
    console.error(`[queue] Job ${jobId} falhou:`, err.message);
    await safeUpdateJob(jobId, {
      status: "failed",
      error: err.message,
      progress: { step: "error", message: err.message },
    });
  } finally {
    activeJobId = null;
    setImmediate(processQueue);
  }
}

async function recoverQueueOnStartup() {
  try {
    await resetStaleRunningJobs();
    const pending = await listPendingJobs();
    for (const job of pending) {
      if (!queue.includes(job.id)) queue.push(job.id);
    }
    if (pending.length) {
      console.log(`[queue] Recuperados ${pending.length} job(s) pendente(s)`);
    }
    processQueue();
  } catch (err) {
    console.error("[queue] Falha ao recuperar fila:", err.message);
  }
}

app.listen(PORT, () => {
  console.log(`\n🚀 Ecoom Direct ADS API — http://0.0.0.0:${PORT}`);
  console.log(`   Frontend CORS: ${FRONTEND_URL}`);
  console.log(`   Root: ${ROOT}\n`);
  void recoverQueueOnStartup();

  setInterval(async () => {
    if (!activeJobId) return;
    try {
      const job = await getJob(activeJobId);
      if (!job || job.status !== "running") {
        activeJobId = null;
        processQueue();
        return;
      }
      const updated = new Date(job.updatedAt || job.createdAt).getTime();
      if (Date.now() - updated > STALE_JOB_MS) {
        console.error(`[queue] Job ${activeJobId} sem progresso — a libertar fila`);
        await safeUpdateJob(activeJobId, {
          status: "failed",
          error:
            "Job bloqueado (sem progresso). Usa Images → Blueprint → Videos passo a passo, ou tenta outra vez.",
          progress: { step: "error", message: "Timeout — fila libertada" },
        });
        activeJobId = null;
        processQueue();
      }
    } catch (err) {
      console.error("[queue] Watchdog:", err.message);
    }
  }, 60_000);
});
