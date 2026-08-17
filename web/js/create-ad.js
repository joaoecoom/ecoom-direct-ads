import {
  createJob,
  fetchConfig,
  fetchJob,
  fetchJobCopy,
  jobVideoUrl,
} from "./api.js";
import {
  calcSceneCount,
  calcTotalDuration,
  getProject,
  linkJobToProject,
  TOTAL_DURATION_PRESETS,
  updateProject,
} from "./projects.js";

let pollTimer = null;
let config = null;
let activeProjectId = null;

const els = {};

export function initCreateAd(projectId) {
  activeProjectId = projectId;
  cacheElements();
  bindEvents();
  loadConfig();
}

function cacheElements() {
  els.form = document.getElementById("create-ad-form");
  els.offer = document.getElementById("master-prompt");
  els.language = document.getElementById("language");
  els.variant = document.getElementById("variant");
  els.format = document.getElementById("format");
  els.scenes = document.getElementById("scenes");
  els.duration = document.getElementById("duration");
  els.totalDuration = document.getElementById("total-duration");
  els.customDurationWrap = document.getElementById("custom-duration-wrap");
  els.customDuration = document.getElementById("custom-duration");
  els.resolution = document.getElementById("resolution");
  els.tone = document.getElementById("tone");
  els.style = document.getElementById("style");
  els.submitBtn = document.getElementById("submit-btn");
  els.error = document.getElementById("create-error");
  els.jobPanel = document.getElementById("job-panel");
  els.statusDot = document.getElementById("status-dot");
  els.jobTitle = document.getElementById("job-title");
  els.jobMessage = document.getElementById("job-message");
  els.videoWrap = document.getElementById("video-wrap");
  els.resultVideo = document.getElementById("result-video");
  els.copyHeading = document.getElementById("copy-heading");
  els.copyBlock = document.getElementById("copy-block");
  els.sceneHint = document.getElementById("scene-hint");
}

function bindEvents() {
  if (els.form.dataset.bound) return;
  els.form.dataset.bound = "1";

  els.language?.addEventListener("change", () => {
    updateVariants();
    persistSettings();
  });
  els.variant?.addEventListener("change", persistSettings);
  els.format?.addEventListener("change", persistSettings);
  els.resolution?.addEventListener("change", persistSettings);
  els.tone?.addEventListener("change", persistSettings);
  els.style?.addEventListener("change", persistSettings);
  els.duration?.addEventListener("change", syncSceneFromTotal);
  els.totalDuration?.addEventListener("change", onTotalDurationChange);
  els.customDuration?.addEventListener("input", syncSceneFromTotal);
  els.scenes?.addEventListener("change", onScenesManualChange);
  els.offer?.addEventListener(
    "blur",
    () => {
      if (!activeProjectId || !els.offer) return;
      updateProject(activeProjectId, { masterPrompt: els.offer.value.trim() });
    },
    { passive: true },
  );

  els.form.addEventListener("submit", onSubmit);
}

function fillSelect(el, items, getValue, getLabel) {
  if (!el) return;
  el.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = getValue(item);
    opt.textContent = getLabel(item);
    el.appendChild(opt);
  }
}

function updateVariants() {
  if (!config || !els.variant) return;
  const lang = els.language.value;
  const variants = config.languageVariants[lang] || [lang];
  fillSelect(els.variant, variants, (v) => v, (v) => v);
}

function onTotalDurationChange() {
  const isCustom = els.totalDuration.value === "custom";
  els.customDurationWrap?.classList.toggle("hidden", !isCustom);
  syncSceneFromTotal();
}

function getTotalSeconds() {
  if (els.totalDuration.value === "custom") {
    return Number.parseInt(els.customDuration.value, 10) || 24;
  }
  return Number.parseInt(els.totalDuration.value, 10);
}

function syncSceneFromTotal() {
  const clip = Number.parseInt(els.duration.value, 10) || 8;
  const total = getTotalSeconds();
  const maxScenes = config?.sceneCounts?.length
    ? Math.max(...config.sceneCounts)
    : 5;
  const suggested = calcSceneCount(total, clip, maxScenes);
  els.scenes.value = String(suggested);
  updateSceneHint(total, clip, suggested, maxScenes);
  persistSettings();
}

function onScenesManualChange() {
  const clip = Number.parseInt(els.duration.value, 10) || 8;
  const scenes = Number.parseInt(els.scenes.value, 10) || 1;
  const total = calcTotalDuration(scenes, clip);
  els.sceneHint.textContent = `Total estimado: ~${total}s (${scenes} × ${clip}s)`;
  persistSettings();
}

function updateSceneHint(total, clip, suggested, maxScenes) {
  const ideal = Math.ceil(total / clip);
  let hint = `Total alvo: ${total}s → ${suggested} cenas (${clip}s cada)`;
  if (ideal > maxScenes) {
    hint += ` · Máx. ${maxScenes} cenas no MVP (Fase 4+: até 30+)`;
  }
  els.sceneHint.textContent = hint;
}

function persistSettings() {
  if (!activeProjectId) return;
  void updateProject(activeProjectId, {
    settings: {
      language: els.language.value,
      languageVariant: els.variant.value,
      aspectRatio: els.format.value,
      clipDurationSeconds: Number(els.duration.value),
      sceneCount: Number(els.scenes.value),
      totalDurationSeconds: getTotalSeconds(),
      resolution: els.resolution.value,
      tone: els.tone.value,
      style: els.style.value,
    },
  });
}

export function refreshCreateAdForm(projectId) {
  activeProjectId = projectId;
  if (!config) return;
  const project = getProject(projectId);
  if (!project) return;

  els.offer.value = project.masterPrompt || "";
  const s = project.settings || {};
  if (s.language) els.language.value = s.language;
  updateVariants();
  if (s.languageVariant) els.variant.value = s.languageVariant;
  if (s.aspectRatio) els.format.value = s.aspectRatio;
  if (s.clipDurationSeconds) els.duration.value = String(s.clipDurationSeconds);
  if (s.sceneCount) els.scenes.value = String(s.sceneCount);
  if (s.resolution) els.resolution.value = s.resolution;
  if (s.tone && els.tone) els.tone.value = s.tone;
  if (s.style && els.style) els.style.value = s.style;

  const total = s.totalDurationSeconds || calcTotalDuration(s.sceneCount || 3, s.clipDurationSeconds || 8);
  const preset = TOTAL_DURATION_PRESETS.find((p) => p.id === total);
  els.totalDuration.value = preset ? String(preset.id) : "custom";
  els.customDurationWrap?.classList.toggle("hidden", preset != null);
  if (!preset) els.customDuration.value = String(total);
  syncSceneFromTotal();
}

async function loadConfig() {
  try {
    config = await fetchConfig();

    fillSelect(els.language, config.languages, (l) => l.id, (l) => l.label);
    fillSelect(els.format, config.aspectRatios, (a) => a.id, (a) => a.label);
    fillSelect(els.scenes, config.sceneCounts, (n) => n, (n) => `${n} cenas`);
    fillSelect(els.duration, config.clipDurations, (n) => n, (n) => `${n}s`);
    fillSelect(
      els.resolution,
      config.resolutions,
      (r) => r.id,
      (r) => r.label,
    );
    fillSelect(els.tone, config.tones, (t) => t.id, (t) => t.label);
    fillSelect(els.style, config.styles, (s) => s.id, (s) => s.label);
    fillSelect(
      els.totalDuration,
      TOTAL_DURATION_PRESETS,
      (p) => String(p.id),
      (p) => p.label,
    );

    if (activeProjectId) refreshCreateAdForm(activeProjectId);
    else {
      els.language.value = "pt";
      updateVariants();
      els.variant.value = "pt-BR";
      els.totalDuration.value = "30";
      syncSceneFromTotal();
    }
  } catch {
    showError("API indisponível. Confirma que a VPS está no ar.");
  }
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.remove("hidden");
}

function hideError() {
  els.error.classList.add("hidden");
}

function setJobUI(job) {
  els.jobPanel.classList.remove("hidden");
  els.jobTitle.textContent = `Geração ${job.id} — ${job.status}`;
  els.jobMessage.textContent = job.progress?.message || "";
  els.statusDot.className = "dot";
  if (job.status === "completed") els.statusDot.classList.add("done");
  else if (job.status === "failed") els.statusDot.classList.add("failed");
  else els.statusDot.classList.add("running");
  if (job.error) {
    els.jobMessage.textContent = job.error;
    els.jobMessage.style.color = "var(--error)";
  }
}

function startPolling(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const job = await fetchJob(jobId);
    if (!job) return;
    setJobUI(job);
    if (job.status === "completed") {
      clearInterval(pollTimer);
      els.resultVideo.src = `${jobVideoUrl(jobId)}?t=${Date.now()}`;
      els.videoWrap.classList.remove("hidden");
      const copy = await fetchJobCopy(jobId);
      if (copy) {
        els.copyBlock.textContent = copy.voiceover || JSON.stringify(copy, null, 2);
        els.copyHeading.classList.remove("hidden");
        els.copyBlock.classList.remove("hidden");
      }
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "Generate Creative";
      if (activeProjectId) {
        window.dispatchEvent(
          new CustomEvent("ecoom:job-complete", {
            detail: { projectId: activeProjectId, jobId },
          }),
        );
      }
    }
    if (job.status === "failed") {
      clearInterval(pollTimer);
      els.submitBtn.disabled = false;
      els.submitBtn.textContent = "Generate Creative";
    }
  }, 3000);
}

async function onSubmit(e) {
  e.preventDefault();
  hideError();
  persistSettings();

  const prompt = els.offer.value.trim();
  if (!prompt) {
    showError("Master Creative Prompt é obrigatório.");
    return;
  }

  if (activeProjectId) {
    void updateProject(activeProjectId, { masterPrompt: prompt });
  }

  els.submitBtn.disabled = true;
  els.submitBtn.textContent = "A enviar...";
  els.videoWrap.classList.add("hidden");
  els.copyHeading.classList.add("hidden");
  els.copyBlock.classList.add("hidden");

  try {
    const data = await createJob({
      offer: prompt,
      projectId: activeProjectId || undefined,
      language: els.language.value,
      languageVariant: els.variant.value,
      aspectRatio: els.format.value,
      sceneCount: Number(els.scenes.value),
      clipDurationSeconds: Number(els.duration.value),
      resolution: els.resolution.value,
      tone: els.tone.value,
      style: els.style.value,
    });

    if (activeProjectId) void linkJobToProject(activeProjectId, data.jobId);

    const job = (await fetchJob(data.jobId)) || {
      id: data.jobId,
      status: "queued",
      progress: { message: "Na fila..." },
    };
    setJobUI(job);
    startPolling(data.jobId);
    els.submitBtn.textContent = "A gerar...";
  } catch (err) {
    showError(err.message || "Erro desconhecido");
    els.submitBtn.disabled = false;
    els.submitBtn.textContent = "Generate Creative";
  }
}

export function destroyCreateAd() {
  if (pollTimer) clearInterval(pollTimer);
}
