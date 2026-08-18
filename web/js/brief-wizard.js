import { WIZARD_DEFAULTS, buildMasterPrompt, settingsToWizard } from "./prompt-template.js";

const STEPS = [
  {
    id: "product",
    title: "O que vamos vender?",
    hint: "Produto, serviço ou oferta — o essencial em 1–2 frases.",
    field: "textarea",
    key: "product",
    placeholder: "Ex: Suplemento de magnésio para mulheres 35+ com fadiga e insónia.",
  },
  {
    id: "persona",
    title: "Quem fala / quem é o público?",
    hint: "Persona UGC, demographics, dor principal.",
    field: "textarea",
    key: "persona",
    placeholder: "Ex: Mulher portuguesa, 40 anos, mãe ativa, tom natural de cozinha.",
  },
  {
    id: "goal",
    title: "Qual é o objetivo?",
    hint: "Conversão, awareness, trial, lista de espera…",
    field: "textarea",
    key: "goal",
    placeholder: "Ex: Levar ao site para experimentar 30 dias com desconto.",
  },
  {
    id: "style-tone",
    title: "Estilo e tom",
    hint: "UGC testimonial, AIDA performance, etc.",
    field: "style-tone",
  },
  {
    id: "format",
    title: "Formato e idioma",
    hint: "Proporção, resolução e variantes linguísticas.",
    field: "format",
  },
  {
    id: "duration",
    title: "Duração aproximada",
    hint: "Opcional — orienta a copy. A IA decide cenas e clip.",
    field: "textarea",
    key: "durationHint",
    placeholder: "Ex: ~45 segundos, ritmo médio · ou curto 15s para hook agressivo",
    optional: true,
  },
  {
    id: "cta",
    title: "CTA desejado",
    hint: "O que queres que a pessoa faça no final.",
    field: "textarea",
    key: "cta",
    placeholder: "Ex: Clica no link e experimenta 7 dias grátis.",
    optional: true,
  },
  {
    id: "extras",
    title: "Algo mais?",
    hint: "Provas sociais, restrições legais, referências visuais…",
    field: "textarea",
    key: "extras",
    placeholder: "Opcional",
    optional: true,
  },
];

let state = { ...WIZARD_DEFAULTS };
let stepIndex = 0;
let config = null;
let onChangeCb = null;

const els = {};

export function initBriefWizard({ container, onChange }) {
  onChangeCb = onChange;
  els.container = container;
  renderShell();
  bindNav();
  renderStep();
  updateProgress();
}

export function setWizardConfig(cfg) {
  config = cfg;
  renderStep();
}

export function loadWizardFromProject(project) {
  state = settingsToWizard(project?.settings || {});
  if (project?.masterPrompt) {
    const parsed = tryParseBrief(project.masterPrompt);
    if (parsed) state = { ...state, ...parsed };
  }
  stepIndex = 0;
  renderStep();
  updateProgress();
}

export function getWizardState() {
  return { ...state };
}

export function getBuiltBrief() {
  return buildMasterPrompt(state);
}

function tryParseBrief(text) {
  if (!text.includes("## Produto")) return null;
  const get = (label) => {
    const re = new RegExp(`## ${label}[\\s\\S]*?\\n([^#\\n][\\s\\S]*?)(?=\\n## |\\n---|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  const styleLine = text.match(/Estilo:\s*(\S+)/i);
  const toneLine = text.match(/Tom:\s*(\S+)/i);
  const ratioLine = text.match(/Proporção:\s*([^\n]+)/i);
  const resLine = text.match(/Resolução:\s*([^\n]+)/i);
  const langLine = text.match(/Idioma:\s*([^\n]+)/i);
  return {
    product: get("Produto / oferta") || get("Produto"),
    persona: get("Persona & público") || get("Persona"),
    goal: get("Objetivo do anúncio") || get("Objetivo"),
    durationHint: get("Duração desejada \\(orientativa\\)") || get("Duração desejada"),
    cta: get("CTA desejado"),
    extras: get("Notas adicionais"),
    style: styleLine?.[1] || WIZARD_DEFAULTS.style,
    tone: toneLine?.[1] || WIZARD_DEFAULTS.tone,
    aspectRatio: ratioLine?.[1]?.trim() || WIZARD_DEFAULTS.aspectRatio,
    resolution: resLine?.[1]?.trim() || WIZARD_DEFAULTS.resolution,
    languageVariant: langLine?.[1]?.trim() || WIZARD_DEFAULTS.languageVariant,
  };
}

function renderShell() {
  if (!els.container) return;
  els.container.innerHTML = `
    <div class="brief-wizard">
      <div class="wizard-progress">
        <div class="wizard-progress-track"><div id="wizard-progress-bar" class="wizard-progress-bar"></div></div>
        <span id="wizard-step-label" class="wizard-step-label"></span>
      </div>
      <div id="wizard-step-body" class="wizard-step-body"></div>
      <div class="wizard-nav">
        <button type="button" class="btn ghost sm" id="wizard-prev">← Anterior</button>
        <button type="button" class="btn sm" id="wizard-next">Seguinte →</button>
      </div>
    </div>
  `;
  els.stepBody = document.getElementById("wizard-step-body");
  els.progressBar = document.getElementById("wizard-progress-bar");
  els.stepLabel = document.getElementById("wizard-step-label");
  els.prevBtn = document.getElementById("wizard-prev");
  els.nextBtn = document.getElementById("wizard-next");
}

function bindNav() {
  els.prevBtn?.addEventListener("click", () => {
    if (stepIndex > 0) {
      stepIndex -= 1;
      renderStep();
      updateProgress();
    }
  });
  els.nextBtn?.addEventListener("click", () => {
    if (stepIndex < STEPS.length - 1) {
      stepIndex += 1;
      renderStep();
      updateProgress();
    } else {
      onChangeCb?.({ complete: true, wizard: getWizardState(), brief: getBuiltBrief() });
    }
  });
}

function updateProgress() {
  const pct = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  if (els.progressBar) els.progressBar.style.width = `${pct}%`;
  if (els.stepLabel) {
    els.stepLabel.textContent = `Passo ${stepIndex + 1} / ${STEPS.length} · ${STEPS[stepIndex].title}`;
  }
  if (els.prevBtn) els.prevBtn.disabled = stepIndex === 0;
  if (els.nextBtn) {
    els.nextBtn.textContent = stepIndex === STEPS.length - 1 ? "Concluir brief →" : "Seguinte →";
  }
}

function emitChange() {
  onChangeCb?.({ wizard: getWizardState(), brief: getBuiltBrief() });
}

function fillSelect(el, items, getValue, getLabel, selected) {
  el.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    const val = getValue(item);
    opt.value = val;
    opt.textContent = getLabel(item);
    if (val === selected) opt.selected = true;
    el.appendChild(opt);
  }
}

function renderStep() {
  const step = STEPS[stepIndex];
  if (!step || !els.stepBody) return;

  if (step.field === "textarea") {
    els.stepBody.innerHTML = `
      <h3 class="wizard-q">${step.title}</h3>
      <p class="muted wizard-hint">${step.hint}${step.optional ? " (opcional)" : ""}</p>
      <textarea id="wizard-field" rows="4" placeholder="${step.placeholder || ""}">${escapeHtml(state[step.key] || "")}</textarea>
    `;
    const field = document.getElementById("wizard-field");
    field?.addEventListener("input", () => {
      state[step.key] = field.value;
      emitChange();
    });
    field?.focus();
    return;
  }

  if (step.field === "style-tone") {
    els.stepBody.innerHTML = `
      <h3 class="wizard-q">${step.title}</h3>
      <p class="muted wizard-hint">${step.hint}</p>
      <div class="grid">
        <div>
          <label for="w-style">Estilo</label>
          <select id="w-style"></select>
        </div>
        <div>
          <label for="w-tone">Tom</label>
          <select id="w-tone"></select>
        </div>
      </div>
    `;
    const styleEl = document.getElementById("w-style");
    const toneEl = document.getElementById("w-tone");
    fillSelect(styleEl, config?.styles || [], (s) => s.id, (s) => s.label, state.style);
    fillSelect(toneEl, config?.tones || [], (t) => t.id, (t) => t.label, state.tone);
    styleEl?.addEventListener("change", () => {
      state.style = styleEl.value;
      emitChange();
    });
    toneEl?.addEventListener("change", () => {
      state.tone = toneEl.value;
      emitChange();
    });
    return;
  }

  if (step.field === "format") {
    els.stepBody.innerHTML = `
      <h3 class="wizard-q">${step.title}</h3>
      <p class="muted wizard-hint">${step.hint}</p>
      <div class="grid">
        <div>
          <label for="w-language">Idioma</label>
          <select id="w-language"></select>
        </div>
        <div>
          <label for="w-variant">Variante</label>
          <select id="w-variant"></select>
        </div>
        <div>
          <label for="w-format">Formato</label>
          <select id="w-format"></select>
        </div>
        <div>
          <label for="w-resolution">Resolução</label>
          <select id="w-resolution"></select>
        </div>
      </div>
    `;
    const langEl = document.getElementById("w-language");
    const varEl = document.getElementById("w-variant");
    const fmtEl = document.getElementById("w-format");
    const resEl = document.getElementById("w-resolution");

    fillSelect(langEl, config?.languages || [], (l) => l.id, (l) => l.label, state.language);
    updateVariants(varEl, state.language, state.languageVariant);
    fillSelect(fmtEl, config?.aspectRatios || [], (a) => a.id, (a) => a.label, state.aspectRatio);
    fillSelect(resEl, config?.resolutions || [], (r) => r.id, (r) => r.label, state.resolution);

    langEl?.addEventListener("change", () => {
      state.language = langEl.value;
      updateVariants(varEl, state.language, null);
      state.languageVariant = varEl.value;
      emitChange();
    });
    varEl?.addEventListener("change", () => {
      state.languageVariant = varEl.value;
      emitChange();
    });
    fmtEl?.addEventListener("change", () => {
      state.aspectRatio = fmtEl.value;
      emitChange();
    });
    resEl?.addEventListener("change", () => {
      state.resolution = resEl.value;
      emitChange();
    });
  }
}

function updateVariants(varEl, lang, selected) {
  const variants = config?.languageVariants?.[lang] || [lang];
  fillSelect(varEl, variants, (v) => v, (v) => v, selected || variants[0]);
  state.languageVariant = varEl.value;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function goToWizardStep(index) {
  stepIndex = Math.max(0, Math.min(STEPS.length - 1, index));
  renderStep();
  updateProgress();
}

export { STEPS };
