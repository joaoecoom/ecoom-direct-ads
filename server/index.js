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
import { runAdGeneration } from "../src/run-ad-generation.js";
import { createJob, getJob, listJobs, updateJob } from "./job-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

const app = express();
app.use(
  cors({
    origin: FRONTEND_URL === "*" ? true : FRONTEND_URL.split(",").map((s) => s.trim()),
  }),
);
app.use(express.json({ limit: "1mb" }));

let activeJobId = null;
const queue = [];

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
  const { offer, ...overrides } = req.body || {};
  if (!offer?.trim()) {
    return res.status(400).json({ error: "Campo 'offer' (brief) é obrigatório." });
  }

  const id = randomUUID().slice(0, 8);
  const job = await createJob({
    id,
    request: { offer: offer.trim(), overrides },
  });

  queue.push(id);
  processQueue();

  res.status(202).json({ jobId: id, status: "queued" });
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
      progress: { step: "starting", message: "A iniciar pipeline..." },
    });

    const { offer, overrides } = job.request;

    const result = await runAdGeneration({
      offer,
      overrides,
      runId: jobId,
      onProgress: async (update) => {
        await updateJob(jobId, {
          status: "running",
          progress: { step: update.step, message: update.message },
        });
      },
    });

    await updateJob(jobId, {
      status: "completed",
      progress: { step: "done", message: "Concluído" },
      result: {
        finalVideo: result.finalVideo,
        copyPath: result.copyPath,
        copy: result.copy,
        storyboardPath: result.storyboardPath,
        title: result.storyboard?.title,
      },
    });
  } catch (err) {
    await updateJob(jobId, {
      status: "failed",
      error: err.message,
      progress: { step: "error", message: err.message },
    });
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
