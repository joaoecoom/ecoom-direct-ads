import { fetchJob } from "./api.js";

const PIPELINE_BY_TYPE = {
  full_ad: ["queued", "copy", "storyboard", "image", "video", "voice", "lipsync", "mix", "done"],
  blueprint: ["queued", "copy", "storyboard", "done"],
  copy: ["queued", "copy", "done"],
  images: ["queued", "image", "done"],
  scene_image: ["queued", "image", "done"],
  videos: ["queued", "video", "done"],
  scene_video: ["queued", "video", "done"],
  rebuild: ["queued", "rebuild", "done"],
};

const STEP_LABELS = {
  queued: "Fila",
  starting: "Início",
  config: "Config",
  copy: "Copy",
  storyboard: "Storyboard",
  image: "Imagens",
  video: "Veo",
  voice: "Voz",
  lipsync: "Lip sync",
  mix: "Mix",
  rebuild: "FFmpeg",
  done: "Pronto",
  error: "Erro",
};

const HUMAN_STEP_INTRO = {
  queued: "Na fila — a aguardar turno…",
  starting: "A arrancar o job…",
  config: "A aplicar configuração do anúncio…",
  copy: "A escrever copy — hook, argumento e CTA…",
  storyboard: "A planear cenas, prompts e timing…",
  image: "A gerar imagens das cenas…",
  video: "A animar clips com Veo…",
  voice: "A gerar voiceover…",
  lipsync: "A sincronizar lábios…",
  mix: "A misturar áudio e vídeo…",
  rebuild: "A remontar timeline final…",
  done: "Concluído.",
  error: "Algo correu mal.",
};

let pollTimer = null;
let activeJobId = null;
let lastLogKey = null;

function formatTime() {
  return new Date().toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stepIndex(steps, step) {
  const idx = steps.indexOf(step);
  return idx === -1 ? 0 : idx;
}

function renderSteps(container, steps, currentStep, status) {
  if (!container) return;
  const currentIdx = stepIndex(steps, currentStep);

  container.innerHTML = steps
    .map((step, i) => {
      let cls = "job-step";
      if (status === "completed" || step === "done") cls += " done";
      else if (status === "failed") cls += i <= currentIdx ? " failed" : "";
      else if (i < currentIdx) cls += " done";
      else if (i === currentIdx) cls += " active";
      return `<span class="${cls}">${STEP_LABELS[step] || step}</span>`;
    })
    .join("");
}

function buildCurrentLine(job) {
  const step = job.progress?.step || (job.status === "queued" ? "queued" : "starting");
  const base = HUMAN_STEP_INTRO[step] || job.progress?.message || job.status;
  const msg = job.progress?.message?.trim();
  const scene =
    job.progress?.sceneIndex && job.progress?.sceneTotal
      ? ` · cena ${job.progress.sceneIndex}/${job.progress.sceneTotal}`
      : "";

  if (msg && msg !== base && !msg.startsWith("A ")) {
    return `${base}${scene} — ${msg}`;
  }
  if (msg && step !== "queued") {
    return `${base}${scene}${msg.includes("…") ? "" : ` — ${msg}`}`;
  }
  return `${base}${scene}`;
}

function appendLog(container, job) {
  if (!container) return;
  const step = job.progress?.step || job.status;
  const message = job.progress?.message || job.status;
  const scene =
    job.progress?.sceneIndex && job.progress?.sceneTotal
      ? ` [${job.progress.sceneIndex}/${job.progress.sceneTotal}]`
      : "";
  const key = `${step}|${message}|${job.progress?.sceneIndex || ""}`;
  if (key === lastLogKey) return;
  lastLogKey = key;

  const line = document.createElement("div");
  line.className = "job-log-line";
  line.innerHTML = `<span class="job-log-time">${formatTime()}</span><span class="job-log-step">${STEP_LABELS[step] || step}${scene}</span><span class="job-log-msg">${escapeHtml(message)}</span>`;
  container.prepend(line);

  const lines = container.querySelectorAll(".job-log-line");
  if (lines.length > 80) lines[lines.length - 1]?.remove();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateProgressBar(job) {
  const bar = document.getElementById("ws-job-progress-bar");
  const label = document.getElementById("ws-job-progress-label");
  if (!bar) return;

  const { sceneIndex, sceneTotal, step } = job.progress || {};
  let pct = 0;

  if (sceneIndex && sceneTotal) {
    pct = Math.round((sceneIndex / sceneTotal) * 100);
    if (label) label.textContent = `${sceneIndex} / ${sceneTotal} cenas`;
  } else if (job.status === "completed") {
    pct = 100;
    if (label) label.textContent = "100%";
  } else if (job.status === "queued") {
    pct = 2;
    if (label) label.textContent = "Na fila…";
  } else {
    const steps = PIPELINE_BY_TYPE[job.type || job.request?.type] || PIPELINE_BY_TYPE.full_ad;
    const idx = stepIndex(steps, step || "starting");
    pct = Math.round(((idx + 1) / steps.length) * 100);
    if (label) label.textContent = `${pct}%`;
  }

  bar.style.width = `${Math.min(100, Math.max(2, pct))}%`;
}

function updateHeader(job) {
  const dot = document.getElementById("ws-job-dot");
  const title = document.getElementById("ws-job-title");
  const current = document.getElementById("ws-job-current");
  const message = document.getElementById("ws-job-message");
  const type = job.type || job.request?.type || "job";
  const typeLabel = STEP_LABELS[type] || type;

  if (title) {
    title.textContent =
      job.status === "completed"
        ? "Concluído"
        : job.status === "failed"
          ? "Falhou"
          : "A processar…";
  }

  const line = buildCurrentLine(job);
  if (current) current.textContent = line;
  if (message) {
    message.textContent = job.error
      ? job.error
      : `Job ${job.id} · ${typeLabel}`;
  }

  if (dot) {
    dot.className = "dot";
    if (job.status === "completed") dot.classList.add("done");
    else if (job.status === "failed") dot.classList.add("failed");
    else dot.classList.add("running");
  }
}

function showPanel(show = true) {
  document.getElementById("workspace-job-activity")?.classList.toggle("hidden", !show);
}

export function stopJobTracking() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  activeJobId = null;
  lastLogKey = null;
}

export function trackJob(jobId, options = {}) {
  const {
    jobType = "full_ad",
    pollMs = 1000,
    onComplete,
    onFailed,
    onUpdate,
    onMissing,
  } = options;

  stopJobTracking();
  activeJobId = jobId;
  lastLogKey = null;
  let missingPolls = 0;

  const log = document.getElementById("ws-job-log");
  const stepsEl = document.getElementById("ws-job-steps");
  if (log) log.innerHTML = "";

  showPanel(true);

  const steps = PIPELINE_BY_TYPE[jobType] || PIPELINE_BY_TYPE.full_ad;

  const failMissing = () => {
    stopJobTracking();
    const msg = "Job perdido no servidor — tenta gerar outra vez.";
    if (log) {
      appendLog(log, {
        status: "failed",
        progress: { step: "error", message: msg },
      });
    }
    updateHeader({ id: jobId, status: "failed", progress: { message: msg, step: "error" } });
    onMissing?.(msg);
    onFailed?.({ id: jobId, status: "failed", error: msg });
  };

  const poll = async () => {
    const job = await fetchJob(jobId);
    if (!job) {
      missingPolls += 1;
      if (missingPolls >= 5) failMissing();
      return;
    }
    missingPolls = 0;
    if (activeJobId !== jobId) return;

    updateHeader(job);
    updateProgressBar(job);
    renderSteps(stepsEl, steps, job.progress?.step || job.status, job.status);
    appendLog(log, job);
    onUpdate?.(job);

    if (job.status === "completed") {
      stopJobTracking();
      renderSteps(stepsEl, steps, "done", "completed");
      updateProgressBar({ ...job, status: "completed", progress: { step: "done" } });
      updateHeader({ ...job, status: "completed", progress: { step: "done", message: "Pronto." } });
      onComplete?.(job);
    }

    if (job.status === "failed") {
      stopJobTracking();
      if (log) {
        appendLog(log, {
          ...job,
          progress: { step: "error", message: job.error || "Falhou" },
        });
      }
      updateHeader(job);
      onFailed?.(job);
    }
  };

  void poll();
  pollTimer = setInterval(poll, pollMs);
}

export function hideJobActivity(delayMs = 8000) {
  if (delayMs <= 0) {
    showPanel(false);
    return;
  }
  setTimeout(() => {
    if (!pollTimer) showPanel(false);
  }, delayMs);
}
