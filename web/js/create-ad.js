import {
  createJob,
  fetchConfig,
  fetchJob,
  fetchJobCopy,
  generateCopy,
  jobVideoUrl,
} from "./api.js";
import {
  getBuiltBrief,
  getWizardState,
  initBriefWizard,
  loadWizardFromProject,
  setWizardConfig,
} from "./brief-wizard.js";
import { formatCopyForDisplay, wizardToSettings } from "./prompt-template.js";
import { trackJob, stopJobTracking } from "./job-activity.js";
import { getProject, linkJobToProject, updateProject } from "./projects.js";

let config = null;
let activeProjectId = null;
let approvedCopy = null;
let wizardReady = false;

const els = {};

export function initCreateAd(projectId) {
  activeProjectId = projectId;
  cacheElements();
  bindEvents();
  initBriefWizard({
    container: document.getElementById("brief-wizard-root"),
    onChange: onWizardChange,
  });
  loadConfig();
}

function cacheElements() {
  els.form = document.getElementById("create-ad-form");
  els.briefPreview = document.getElementById("brief-preview");
  els.briefSection = document.getElementById("brief-review-section");
  els.wizardSection = document.getElementById("wizard-section");
  els.copyReview = document.getElementById("copy-review-section");
  els.copyHook = document.getElementById("copy-hook");
  els.copyVoiceover = document.getElementById("copy-voiceover");
  els.copyCta = document.getElementById("copy-cta");
  els.copyMeta = document.getElementById("copy-meta");
  els.genCopyBtn = document.getElementById("btn-gen-copy");
  els.genVideoBtn = document.getElementById("submit-btn");
  els.editBriefBtn = document.getElementById("btn-edit-brief");
  els.error = document.getElementById("create-error");
  els.jobPanel = document.getElementById("job-panel");
  els.statusDot = document.getElementById("status-dot");
  els.jobTitle = document.getElementById("job-title");
  els.jobMessage = document.getElementById("job-message");
  els.videoWrap = document.getElementById("video-wrap");
  els.resultVideo = document.getElementById("result-video");
  els.copyHeading = document.getElementById("copy-heading");
  els.copyBlock = document.getElementById("copy-block");
}

function bindEvents() {
  if (els.form?.dataset.bound) return;
  els.form.dataset.bound = "1";

  els.briefPreview?.addEventListener("input", () => {
    if (activeProjectId) {
      void updateProject(activeProjectId, { masterPrompt: els.briefPreview.value.trim() });
    }
  });

  els.editBriefBtn?.addEventListener("click", () => {
    els.briefSection?.classList.add("hidden");
    els.wizardSection?.classList.remove("hidden");
  });

  els.genCopyBtn?.addEventListener("click", () => void onGenerateCopy());
  els.genVideoBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    void onGenerateVideo();
  });
}

function onWizardChange({ complete, brief }) {
  if (brief && els.briefPreview) {
    els.briefPreview.value = brief;
  }
  if (complete) {
    showBriefReview();
    persistWizard();
  } else if (wizardReady) {
    persistWizard();
  }
}

function showBriefReview() {
  els.wizardSection?.classList.add("hidden");
  els.briefSection?.classList.remove("hidden");
  if (els.briefPreview) els.briefPreview.value = getBuiltBrief();
  if (els.genCopyBtn) els.genCopyBtn.disabled = false;
}

function persistWizard() {
  if (!activeProjectId) return;
  const wizard = getWizardState();
  void updateProject(activeProjectId, {
    masterPrompt: getBuiltBrief(),
    settings: wizardToSettings(wizard, config),
  });
}

export function refreshCreateAdForm(projectId) {
  activeProjectId = projectId;
  if (!config) return;
  const project = getProject(projectId);
  if (!project) return;

  loadWizardFromProject(project);
  setWizardConfig(config);
  wizardReady = true;

  if (project.masterPrompt?.includes("## Produto")) {
    if (els.briefPreview) els.briefPreview.value = project.masterPrompt;
    showBriefReview();
  } else if (project.masterPrompt && els.briefPreview) {
    els.briefPreview.value = project.masterPrompt;
  }

  if (project.latestCopy) {
    showCopyReview(project.latestCopy);
  } else {
    els.copyReview?.classList.add("hidden");
    approvedCopy = null;
  }
}

async function loadConfig() {
  try {
    config = await fetchConfig();
    setWizardConfig(config);
    wizardReady = true;
    if (activeProjectId) refreshCreateAdForm(activeProjectId);
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

function showCopyReview(copy) {
  approvedCopy = { ...copy };
  els.copyReview?.classList.remove("hidden");
  if (els.copyHook) els.copyHook.value = copy.hook || "";
  if (els.copyVoiceover) els.copyVoiceover.value = copy.voiceover || "";
  if (els.copyCta) els.copyCta.value = copy.cta || "";
  if (els.copyMeta) {
    const parts = [];
    if (copy.targetDurationSeconds) parts.push(`~${copy.targetDurationSeconds}s`);
    if (copy.persona) parts.push(copy.persona);
    els.copyMeta.textContent = parts.join(" · ") || "Copy pronta — revê antes de gerar vídeo.";
  }
  if (els.genVideoBtn) els.genVideoBtn.disabled = false;
}

function readApprovedCopyFromForm() {
  return {
    ...approvedCopy,
    hook: els.copyHook?.value?.trim() || approvedCopy?.hook,
    voiceover: els.copyVoiceover?.value?.trim() || approvedCopy?.voiceover,
    cta: els.copyCta?.value?.trim() || approvedCopy?.cta,
  };
}

function getBrief() {
  return (els.briefPreview?.value || getBuiltBrief()).trim();
}

async function onGenerateCopy() {
  hideError();
  const brief = getBrief();
  if (!brief) {
    showError("Completa o brief antes de gerar copy.");
    return;
  }
  if (!activeProjectId) {
    showError("Selecciona um projecto.");
    return;
  }

  persistWizard();
  void updateProject(activeProjectId, { masterPrompt: brief });

  els.genCopyBtn.disabled = true;
  els.genCopyBtn.textContent = "A gerar copy…";

  try {
    const wizard = getWizardState();
    const settings = wizardToSettings(wizard, config);
    const data = await generateCopy(activeProjectId, {
      offer: brief,
      overrides: settings,
      wizard,
    });

    void linkJobToProject(activeProjectId, data.jobId);
    setJobUI({ id: data.jobId, status: "queued", progress: { message: "Na fila…" } });

    trackJob(data.jobId, {
      jobType: "copy",
      pollMs: 1000,
      onUpdate: setJobUI,
      onMissing: (msg) => showError(msg),
      onComplete: async () => {
        const copy = await fetchJobCopy(data.jobId);
        if (copy) {
          showCopyReview(copy);
        }
        els.genCopyBtn.disabled = false;
        els.genCopyBtn.textContent = "Gerar Copy";
        window.dispatchEvent(
          new CustomEvent("ecoom:copy-ready", { detail: { projectId: activeProjectId } }),
        );
      },
      onFailed: (job) => {
        setJobUI(job);
        showError(job.error || "Copy falhou");
        els.genCopyBtn.disabled = false;
        els.genCopyBtn.textContent = "Gerar Copy";
      },
    });
  } catch (err) {
    showError(err.message || "Erro desconhecido");
    els.genCopyBtn.disabled = false;
    els.genCopyBtn.textContent = "Gerar Copy";
  }
}

async function onGenerateVideo() {
  hideError();
  const brief = getBrief();
  const copy = readApprovedCopyFromForm();

  if (!brief) {
    showError("Brief em falta.");
    return;
  }
  if (!copy?.voiceover?.trim()) {
    showError("Gera e aprova a copy primeiro.");
    return;
  }

  persistWizard();
  approvedCopy = copy;

  els.genVideoBtn.disabled = true;
  els.genVideoBtn.textContent = "A gerar…";
  els.videoWrap?.classList.add("hidden");
  els.copyHeading?.classList.add("hidden");
  els.copyBlock?.classList.add("hidden");

  try {
    const wizard = getWizardState();
    const settings = wizardToSettings(wizard, config);
    const data = await createJob({
      offer: brief,
      projectId: activeProjectId,
      approvedCopy: copy,
      wizard,
      ...settings,
    });

    void linkJobToProject(activeProjectId, data.jobId);
    const job = (await fetchJob(data.jobId)) || {
      id: data.jobId,
      status: "queued",
      progress: { message: "Na fila…" },
    };
    setJobUI(job);

    trackJob(data.jobId, {
      jobType: "full_ad",
      pollMs: 1000,
      onUpdate: setJobUI,
      onMissing: (msg) => showError(msg),
      onComplete: async (completedJob) => {
        setJobUI(completedJob);
        els.resultVideo.src = `${jobVideoUrl(data.jobId)}?t=${Date.now()}`;
        els.videoWrap.classList.remove("hidden");
        const resultCopy = await fetchJobCopy(data.jobId);
        if (resultCopy) {
          els.copyBlock.textContent = formatCopyForDisplay(resultCopy);
          els.copyHeading.classList.remove("hidden");
          els.copyBlock.classList.remove("hidden");
        }
        els.genVideoBtn.disabled = false;
        els.genVideoBtn.textContent = "Gerar Vídeo Completo";
        window.dispatchEvent(
          new CustomEvent("ecoom:job-complete", {
            detail: { projectId: activeProjectId, jobId: data.jobId },
          }),
        );
      },
      onFailed: (failedJob) => {
        setJobUI(failedJob);
        showError(failedJob.error || "Geração falhou");
        els.genVideoBtn.disabled = false;
        els.genVideoBtn.textContent = "Gerar Vídeo Completo";
      },
    });
  } catch (err) {
    showError(err.message || "Erro desconhecido");
    els.genVideoBtn.disabled = false;
    els.genVideoBtn.textContent = "Gerar Vídeo Completo";
  }
}

export function destroyCreateAd() {
  stopJobTracking();
}
