const API_URL = window.ECOOM_API_URL;

const form = document.getElementById("ad-form");
const offerEl = document.getElementById("offer");
const languageEl = document.getElementById("language");
const variantEl = document.getElementById("variant");
const formatEl = document.getElementById("format");
const scenesEl = document.getElementById("scenes");
const durationEl = document.getElementById("duration");
const resolutionEl = document.getElementById("resolution");
const submitBtn = document.getElementById("submit-btn");
const errorEl = document.getElementById("error");
const jobPanel = document.getElementById("job-panel");
const statusDot = document.getElementById("status-dot");
const jobTitle = document.getElementById("job-title");
const jobMessage = document.getElementById("job-message");
const videoWrap = document.getElementById("video-wrap");
const resultVideo = document.getElementById("result-video");
const copyHeading = document.getElementById("copy-heading");
const copyBlock = document.getElementById("copy-block");

let pollTimer = null;
let config = null;

function fillSelect(el, items, getValue, getLabel) {
  el.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = getValue(item);
    opt.textContent = getLabel(item);
    el.appendChild(opt);
  }
}

function updateVariants() {
  if (!config) return;
  const lang = languageEl.value;
  const variants = config.languageVariants[lang] || [lang];
  fillSelect(variantEl, variants, (v) => v, (v) => v);
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
}

function hideError() {
  errorEl.classList.add("hidden");
}

function setJobUI(job) {
  jobPanel.classList.remove("hidden");
  jobTitle.textContent = `Job ${job.id} — ${job.status}`;
  jobMessage.textContent = job.progress?.message || "";
  statusDot.className = "dot";
  if (job.status === "completed") statusDot.classList.add("done");
  else if (job.status === "failed") statusDot.classList.add("failed");
  else statusDot.classList.add("running");

  if (job.error) {
    jobMessage.textContent = job.error;
    jobMessage.style.color = "var(--error)";
  }
}

async function loadConfig() {
  try {
    const res = await fetch(`${API_URL}/api/config`);
    if (!res.ok) throw new Error("Config indisponível");
    config = await res.json();

    fillSelect(languageEl, config.languages, (l) => l.id, (l) => l.label);
    fillSelect(formatEl, config.aspectRatios, (a) => a.id, (a) => a.label);
    fillSelect(scenesEl, config.sceneCounts, (n) => n, (n) => `${n} cenas`);
    fillSelect(durationEl, config.clipDurations, (n) => n, (n) => `${n}s`);
    fillSelect(
      resolutionEl,
      config.resolutions,
      (r) => r.id,
      (r) => r.label,
    );

    languageEl.value = "pt";
    updateVariants();
    variantEl.value = "pt-BR";
    scenesEl.value = "1";
    durationEl.value = "8";
  } catch {
    showError(`API indisponível em ${API_URL}. Confirma que a VPS está no ar.`);
  }
}

async function pollJob(jobId) {
  const res = await fetch(`${API_URL}/api/jobs/${jobId}`);
  if (!res.ok) return null;
  return res.json();
}

function startPolling(jobId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const job = await pollJob(jobId);
    if (!job) return;
    setJobUI(job);
    if (job.status === "completed") {
      clearInterval(pollTimer);
      resultVideo.src = `${API_URL}/api/jobs/${jobId}/video?t=${Date.now()}`;
      videoWrap.classList.remove("hidden");

      const copyRes = await fetch(`${API_URL}/api/jobs/${jobId}/copy`);
      if (copyRes.ok) {
        const copy = await copyRes.json();
        copyBlock.textContent = copy.voiceover || JSON.stringify(copy, null, 2);
        copyHeading.classList.remove("hidden");
        copyBlock.classList.remove("hidden");
      }
      submitBtn.disabled = false;
      submitBtn.textContent = "Gerar anúncio";
    }
    if (job.status === "failed") {
      clearInterval(pollTimer);
      submitBtn.disabled = false;
      submitBtn.textContent = "Gerar anúncio";
    }
  }, 3000);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  submitBtn.disabled = true;
  submitBtn.textContent = "A enviar...";
  videoWrap.classList.add("hidden");
  copyHeading.classList.add("hidden");
  copyBlock.classList.add("hidden");

  try {
    const res = await fetch(`${API_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offer: offerEl.value.trim(),
        language: languageEl.value,
        languageVariant: variantEl.value,
        aspectRatio: formatEl.value,
        sceneCount: Number(scenesEl.value),
        clipDurationSeconds: Number(durationEl.value),
        resolution: resolutionEl.value,
        tone: "amigavel",
        style: "ugc",
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao criar job");

    const job = (await pollJob(data.jobId)) || {
      id: data.jobId,
      status: "queued",
      progress: { message: "Na fila..." },
    };
    setJobUI(job);
    startPolling(data.jobId);
    submitBtn.textContent = "A gerar...";
  } catch (err) {
    showError(err.message || "Erro desconhecido");
    submitBtn.disabled = false;
    submitBtn.textContent = "Gerar anúncio";
  }
});

languageEl.addEventListener("change", updateVariants);
loadConfig();
