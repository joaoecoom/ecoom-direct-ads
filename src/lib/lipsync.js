import fs from "node:fs/promises";
import path from "node:path";
import { Blob } from "node:buffer";
import { loadConfig, sleep } from "../config.js";
import { Storage } from "@google-cloud/storage";

const API_BASE = "https://api.sync.so/v2";
const POLL_MS = 5000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function getApiKey() {
  const key = process.env.SYNC_LABS_API_KEY;
  if (!key) {
    throw new Error(
      "SYNC_LABS_API_KEY em falta — necessário para lip sync real (https://sync.so).",
    );
  }
  return key;
}

async function uploadToGcsAndSign(localPath, prefix = "lipsync-input") {
  const { gcsOutputUri } = loadConfig();
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gcsOutputUri);
  if (!match) throw new Error(`GCS_OUTPUT_URI inválido: ${gcsOutputUri}`);
  const bucket = match[1];
  const basePrefix = match[2].replace(/\/?$/, "");
  const objectPath = `${basePrefix}/${prefix}/${Date.now()}-${path.basename(localPath)}`;
  const storage = new Storage();
  await storage.bucket(bucket).upload(path.resolve(localPath), {
    destination: objectPath,
    metadata: { cacheControl: "private, max-age=3600" },
  });
  const [signedUrl] = await storage.bucket(bucket).file(objectPath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  });
  return signedUrl;
}

async function createGenerationWithFiles(videoPath, audioPath) {
  const apiKey = getApiKey();
  const model = process.env.SYNC_LABS_MODEL || "lipsync-2";
  const videoStat = await fs.stat(videoPath);
  const audioStat = await fs.stat(audioPath);

  let response;

  if (videoStat.size <= MAX_UPLOAD_BYTES && audioStat.size <= MAX_UPLOAD_BYTES) {
    const form = new FormData();
    const videoBuf = await fs.readFile(videoPath);
    const audioBuf = await fs.readFile(audioPath);
    form.append(
      "video",
      new Blob([videoBuf], { type: "video/mp4" }),
      path.basename(videoPath),
    );
    form.append(
      "audio",
      new Blob([audioBuf], { type: "audio/mpeg" }),
      path.basename(audioPath),
    );
    form.append("model", model);
    form.append("options", JSON.stringify({ sync_mode: "cut_off" }));

    response = await fetch(`${API_BASE}/generate`, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
    });
  } else {
    console.log("   Ficheiros >20MB — a usar URLs GCS assinadas...");
    const videoUrl = await uploadToGcsAndSign(videoPath);
    const audioUrl = await uploadToGcsAndSign(audioPath);
    response = await fetch(`${API_BASE}/generate`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          { type: "video", url: videoUrl },
          { type: "audio", url: audioUrl },
        ],
        options: { sync_mode: "cut_off" },
      }),
    });
  }

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Sync Labs erro ${response.status}: ${err.slice(0, 400)}`);
  }

  return response.json();
}

async function waitForGeneration(id) {
  const apiKey = getApiKey();
  while (true) {
    const res = await fetch(`${API_BASE}/generate/${id}`, {
      headers: { "x-api-key": apiKey },
    });
    if (!res.ok) {
      throw new Error(`Sync Labs poll erro ${res.status}`);
    }
    const job = await res.json();
    if (job.status === "COMPLETED") return job;
    if (job.status === "FAILED" || job.status === "REJECTED") {
      throw new Error(`Lip sync falhou: ${job.error || job.status}`);
    }
    process.stdout.write(".");
    await sleep(POLL_MS);
  }
}

async function downloadUrl(url, outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download lip sync falhou: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outputPath, buf);
}

/**
 * Lip sync real: vídeo Veo + áudio TTS → boca sincronizada com a fala.
 */
export async function lipSyncVideo({ videoPath, audioPath, outputPath }) {
  console.log("👄 Sync Labs lip sync...");
  console.log(`   Vídeo: ${path.basename(videoPath)}`);
  console.log(`   Áudio: ${path.basename(audioPath)}`);

  const job = await createGenerationWithFiles(videoPath, audioPath);
  console.log(`   Job: ${job.id}`);

  const done = await waitForGeneration(job.id);
  console.log("");

  if (!done.outputUrl) {
    throw new Error("Sync Labs concluiu sem outputUrl.");
  }

  await downloadUrl(done.outputUrl, outputPath);
  console.log(`✅ Lip sync: ${outputPath}\n`);
  return outputPath;
}

export function isLipSyncAvailable() {
  return Boolean(process.env.SYNC_LABS_API_KEY);
}

/**
 * Por cena: Veo clip + TTS → clip com lip sync.
 */
export async function lipSyncSceneClips(scenes, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const synced = [];

  for (const scene of scenes) {
    const out = path.join(outputDir, `${scene.id}-synced.mp4`);
    console.log(`--- Lip sync ${scene.id} ---`);
    await lipSyncVideo({
      videoPath: scene.videoPath,
      audioPath: scene.audioPath,
      outputPath: out,
    });
    synced.push(out);
  }

  return synced;
}
