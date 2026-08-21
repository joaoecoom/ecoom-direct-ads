import fs from "node:fs";
import path from "node:path";
import {
  createRun,
  getWorkflow,
  isFloyoConfigured,
  pollRunUntilDone,
} from "./floyo-client.js";
import { getModelEntry, resolveWorkflowId } from "./model-registry.js";

const stats = {
  lastRequestAt: null,
  lastError: null,
  errorCount: 0,
  lastLatencyMs: null,
};

function loadInputPatch(envKey) {
  if (!envKey) return null;
  const raw = process.env[envKey];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cloneWorkflowPrompt(prompt) {
  return JSON.parse(JSON.stringify(prompt));
}

/**
 * Patch ComfyUI workflow prompt nodes.
 * Custom patches via env JSON take precedence; otherwise heuristic text/image patch.
 */
export function patchWorkflowPrompt(prompt, { text, imageFileName, customPatch } = {}) {
  const wf = cloneWorkflowPrompt(prompt);
  if (customPatch && typeof customPatch === "object") {
    for (const [nodeId, inputs] of Object.entries(customPatch)) {
      if (!wf[nodeId]) continue;
      wf[nodeId].inputs = { ...wf[nodeId].inputs, ...inputs };
    }
    return wf;
  }

  const textNodes = [];
  for (const [nodeId, node] of Object.entries(wf)) {
    if (node?.class_type === "CLIPTextEncode") textNodes.push(nodeId);
    if (node?.class_type === "LoadImage" && imageFileName) {
      wf[nodeId].inputs = { ...wf[nodeId].inputs, image: imageFileName };
    }
  }

  if (text && textNodes.length) {
    wf[textNodes[0]].inputs = { ...wf[textNodes[0]].inputs, text };
  }

  return wf;
}

async function downloadOutputVideo(outputs, outputFileName) {
  const video = (outputs || []).find((o) =>
    (o.mime_type || "").startsWith("video/") || /\.mp4$/i.test(o.file_name || ""),
  );
  if (!video) {
    throw new Error("Floyo run complete mas sem output de vídeo");
  }

  const url = video.presigned_url || video.url;
  if (!url) throw new Error("Floyo output sem URL de download");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download Floyo falhou: HTTP ${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(path.dirname(outputFileName), { recursive: true });
  await fs.promises.writeFile(outputFileName, buf);
  return outputFileName;
}

export const floyoProvider = {
  id: "floyo",
  name: "Floyo",

  getCapabilities(modelId = "floyo:ltx-2.3:i2v") {
    const entry = getModelEntry(modelId);
    return {
      taskTypes: ["video"],
      aspectRatios: entry?.supportedAspectRatios || ["9:16", "16:9"],
      durations: entry?.supportedDurations || [8],
      textToVideo: entry?.taskType === "text-to-video",
      imageToVideo: entry?.taskType === "image-to-video" || true,
      dialogue: false,
      lipSync: false,
      qualityTier: entry?.qualityTier || "open",
    };
  },

  estimateCost(request, modelId = "floyo:ltx-2.3:i2v") {
    const entry = getModelEntry(modelId);
    const rate = Number(process.env.FLOYO_GPU_COST_USD_PER_MIN || "0");
    const gpuMs = entry?.estimatedGpuTimeMs || null;
    let estimatedCostUsd = entry?.estimatedCostUsdPerRun ?? null;
    if (estimatedCostUsd == null && gpuMs != null && rate > 0) {
      estimatedCostUsd = (gpuMs / 60000) * rate;
    }
    return {
      estimatedCostUsd,
      estimatedGpuTimeMs: gpuMs,
      costUnknown: estimatedCostUsd == null,
      costType: entry?.costType || "gpu_time",
      provider: "floyo",
      model: entry?.model || modelId,
      qualityTier: entry?.qualityTier || "open",
      note: estimatedCostUsd == null ? "COST UNKNOWN — heurística; Floyo devolve flotime_ms após run" : "Heurística configurável",
    };
  },

  async healthCheck() {
    if (!isFloyoConfigured()) {
      return {
        id: "floyo",
        name: "Floyo",
        status: "disconnected",
        message: "FLOYO_API_KEY não configurada",
        latencyMs: null,
        errorCount: stats.errorCount,
        lastRequestAt: stats.lastRequestAt,
        lastError: stats.lastError,
      };
    }
    try {
      const { listWorkflows } = await import("./floyo-client.js");
      const { latencyMs } = await listWorkflows({ limit: 10 });
      stats.lastLatencyMs = latencyMs;
      stats.lastRequestAt = new Date().toISOString();
      return {
        id: "floyo",
        name: "Floyo",
        status: "connected",
        latencyMs,
        errorCount: stats.errorCount,
        lastRequestAt: stats.lastRequestAt,
        lastError: stats.lastError,
      };
    } catch (err) {
      stats.errorCount += 1;
      stats.lastError = err.message;
      return {
        id: "floyo",
        name: "Floyo",
        status: "degraded",
        message: err.message,
        latencyMs: err.latencyMs || null,
        errorCount: stats.errorCount,
        lastRequestAt: stats.lastRequestAt,
        lastError: stats.lastError,
      };
    }
  },

  async generateVideo(request, modelId) {
    if (!isFloyoConfigured()) {
      return { ok: false, provider: "floyo", model: modelId || "unknown", error: "FLOYO_API_KEY não configurada" };
    }

    const entry = getModelEntry(modelId) || getModelEntry("floyo:ltx-2.3:i2v");
    const workflowId = resolveWorkflowId(entry);
    if (!workflowId) {
      return {
        ok: false,
        provider: "floyo",
        model: entry.model,
        error: `Workflow não configurado — define ${entry.workflowIdEnv} no servidor`,
      };
    }

    try {
      stats.lastRequestAt = new Date().toISOString();
      const { data: wfData } = await getWorkflow(workflowId);
      if (!wfData?.prompt) {
        throw new Error(`Workflow ${workflowId} sem prompt JSON`);
      }

      const customPatch = loadInputPatch(entry.inputPatchEnv);
      const imageBase = request.imagePath ? path.basename(request.imagePath) : undefined;
      const workflow = patchWorkflowPrompt(wfData.prompt, {
        text: request.prompt,
        imageFileName: imageBase,
        customPatch,
      });

      const { data: runCreated } = await createRun({
        name: request.runLabel || `ecoom-${Date.now()}`,
        workflow,
      });

      const run = await pollRunUntilDone(runCreated.id, {
        onStatus: (s) => {
          if (s.status === "failed") {
            throw new Error(s.error?.message || s.error || "Floyo run failed");
          }
        },
      });

      if (run.status !== "complete") {
        throw new Error(`Floyo run terminou com status: ${run.status}`);
      }

      const outputFile = request.outputFileName || path.join(process.cwd(), "output", `floyo-${run.id}.mp4`);
      await downloadOutputVideo(run.outputs, outputFile);

      const actualCostUsd =
        run.partner_nodes_cost_usd != null
          ? run.partner_nodes_cost_usd
          : null;

      return {
        ok: true,
        localPath: outputFile,
        provider: "floyo",
        model: entry.model,
        workflowId,
        providerRequestId: run.id,
        actualCostUsd,
        gpuTimeMs: run.flotime_ms ?? null,
        metadata: {
          floyoRunId: run.id,
          workflowId,
          modelId: entry.id,
          costUnknown: actualCostUsd == null && run.flotime_ms == null,
        },
      };
    } catch (err) {
      stats.errorCount += 1;
      stats.lastError = err.message;
      return {
        ok: false,
        provider: "floyo",
        model: entry?.model || modelId,
        error: err.message,
        providerRequestId: err.data?.id || null,
        metadata: { workflowId },
      };
    }
  },
};
