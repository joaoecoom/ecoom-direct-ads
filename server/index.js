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
  AD_SCENE_COUNTS,
  AD_STYLES,
  AD_TONES,
  LANGUAGE_VARIANTS,
} from "../src/lib/ad-config.js";
import { createJob, getJob, listJobs, updateJob } from "./job-store.js";
import {
  createAsset,
  deleteAsset,
  getAsset,
  listAssetsByProject,
  resolveAssetFile,
} from "./asset-store.js";
import {
  addProjectAssetId,
  createProject,
  deleteProject,
  duplicateProject,
  getProject,
  linkAssetToScene,
  listProjects,
  updateProject,
} from "./project-store.js";
import { persistJobFailed, persistJobProgress, runJob } from "./workers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

let activeJobId = null;
const queue = [];

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
  res.json({ ok: true, service: "ecoom-direct-ads-api", activeJobId });
});

app.get("/api/config", (_req, res) => {
  res.json({
    languages: AD_LANGUAGES,
    languageVariants: LANGUAGE_VARIANTS,
    aspectRatios: AD_ASPECT_RATIOS,
    clipDurations: AD_CLIP_DURATIONS,
    sceneCounts: AD_SCENE_COUNTS,
    resolutions: AD_RESOLUTIONS,
    tones: AD_TONES,
    styles: AD_STYLES,
    features: {
      projects: true,
      assets: true,
      videos: true,
      maxSceneCount: Math.max(...AD_SCENE_COUNTS),
    },
  });
});

app.get("/api/projects", async (_req, res) => {
  const projects = await listProjects();
  res.json({ projects });
});

app.post("/api/projects", async (req, res) => {
  const { name, masterPrompt, settings } = req.body || {};
  const project = await createProject({ name, masterPrompt, settings });
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

  const storyboardPath =
    project.blueprintPath ||
    project.latestCreative?.storyboardPath ||
    project.creatives?.slice(-1)[0]?.storyboardPath;

  if (!storyboardPath || !fs.existsSync(storyboardPath)) {
    return res.status(404).json({ error: "Storyboard ainda não disponível" });
  }

  const raw = fs.readFileSync(storyboardPath, "utf8");
  res.json(JSON.parse(raw));
});

app.get("/api/projects/:id/assets", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });
  const assets = await listAssetsByProject(req.params.id);
  res.json({ assets, scenes: project.scenes || [] });
});

app.post("/api/projects/:id/assets", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const { data, filename, sceneId, mimeType } = req.body || {};
  if (!data) return res.status(400).json({ error: "Campo 'data' (base64) obrigatório" });

  const buffer = Buffer.from(data, "base64");
  if (buffer.length > 6 * 1024 * 1024) {
    return res.status(400).json({ error: "Imagem demasiado grande (max 6MB)" });
  }

  const ext = (filename || "upload.png").split(".").pop() || "png";
  const asset = await createAsset({
    projectId: req.params.id,
    sceneId: sceneId || null,
    type: "image",
    source: "upload",
    prompt: filename || "upload",
    fileBuffer: buffer,
    ext,
    metadata: { mimeType: mimeType || "image/png", originalName: filename },
  });

  await addProjectAssetId(req.params.id, asset.id);
  if (sceneId) await linkAssetToScene(req.params.id, sceneId, asset.id);

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

app.post("/api/projects/:id/blueprint", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const offer = (req.body?.offer || project.masterPrompt || "").trim();
  if (!offer) return res.status(400).json({ error: "Master prompt em falta" });

  const overrides = { ...project.settings, ...req.body?.overrides };
  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "blueprint",
    request: { type: "blueprint", offer, overrides, projectId: req.params.id },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "blueprint" });
});

app.post("/api/projects/:id/images/generate", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  if (!project.blueprintPath && !project.latestCreative?.storyboardPath) {
    return res.status(400).json({ error: "Gera o blueprint primeiro" });
  }

  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "images",
    request: { type: "images", projectId: req.params.id, overrides: project.settings },
  });

  enqueue(id);
  res.status(202).json({ jobId: id, status: "queued", type: "images" });
});

app.post("/api/projects/:id/scenes/:sceneId/image", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Projecto não encontrado" });

  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "scene_image",
    request: {
      type: "scene_image",
      projectId: req.params.id,
      sceneId: req.params.sceneId,
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

  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "videos",
    request: { type: "videos", projectId: req.params.id },
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
  const { offer, projectId, ...overrides } = req.body || {};
  if (!offer?.trim()) {
    return res.status(400).json({ error: "Campo 'offer' (brief) é obrigatório." });
  }

  if (projectId) {
    const project = await getProject(projectId);
    if (!project) {
      return res.status(404).json({ error: "Projecto não encontrado" });
    }
  }

  const id = randomUUID().slice(0, 8);
  await createJob({
    id,
    type: "full_ad",
    request: {
      type: "full_ad",
      offer: offer.trim(),
      overrides,
      projectId: projectId || null,
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
    if (!job) return;

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
    await persistJobFailed(jobId, err);
  } finally {
    activeJobId = null;
    processQueue();
  }
}

app.listen(PORT, () => {
  console.log(`\n🚀 Ecoom Direct ADS API — http://0.0.0.0:${PORT}`);
  console.log(`   Frontend CORS: ${FRONTEND_URL}`);
  console.log(`   Root: ${ROOT}\n`);
});
