import { listen } from "@tauri-apps/api/event";
import { api, errorText } from "./api";
import { h, isTextEditing, renderReport } from "./dom";
import { AUTO, FREE, buildPrompt, estimateTokens } from "./prompt";
import { customSelect } from "./select";
import { checkForUpdates, initUpdater } from "./updater";
import { initWordEdit, wordText } from "./word-edit";
import { confirmDialog } from "./dialog";
import { openReportDialog } from "./report-dialog";
import { openSettings, settingsOpen } from "./settings-view";
import type { ModelStatus, Part, Settings } from "./types";

// Tüm oturum verisi yalnızca bu bellekte yaşar; hiçbir yere yazılmaz.
let settings: Settings;
let parts: Part[] = [];
let output = "";
let editingOutput = false;
let undoSnapshot: { parts: Part[]; output: string } | null = null;
let modelStatus: ModelStatus = { state: "checking" };
let processing = false;
let templateChoice = AUTO;
let nextId = 1;

let recording: Promise<boolean> | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init() {
  settings = await api.getSettings();
  modelStatus = await api.modelStatus();
  await listen<ModelStatus>("model-status", (e) => {
    modelStatus = e.payload;
    renderModelStatus();
  });
  await listen<number>("mic-level", (e) => {
    const level = Math.min(1, Math.sqrt(e.payload) * 1.4);
    $("rec-indicator").style.setProperty("--level", level.toFixed(3));
  });
  initWordEdit({
    rerender: renderParts,
    find: (id) => parts.find((p) => p.id === id),
    remove: removePart,
  });
  initUpdater({ notify: toast, hasSession: () => parts.length > 0 || output !== "" || undoSnapshot !== null });
  await listen("check-updates", () => void checkForUpdates(true));
  if (settings.autoUpdateCheck) window.setTimeout(() => void checkForUpdates(false), 4000);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => void stopRecording());
  $("btn-settings").addEventListener("click", () => {
    openSettings(settings, (saved) => {
      settings = saved;
      render();
    });
  });
  $("btn-report").addEventListener("click", () => openReportDialog(reportDetails(), toast));
  $("btn-process").addEventListener("click", () => void processParts());
  $("btn-copy").addEventListener("click", () => void copyReport());
  $("btn-undo").addEventListener("click", undo);
  $("btn-edit").addEventListener("click", toggleEditOutput);
  $("btn-clear").addEventListener("click", () => void clearSession());
  $("btn-select-all").addEventListener("click", toggleSelectAll);
  render();
}

// ---------- Kayıt ----------

function onKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !settingsOpen()) {
    e.preventDefault();
    void processParts();
    return;
  }
  if (e.code !== "Space" || settingsOpen() || isTextEditing(e.target)) return;
  e.preventDefault();
  if (e.repeat || recording) return;
  if (modelStatus.state !== "ready") {
    toast("Whisper modeli hazır değil.", "error");
    return;
  }
  recording = api
    .startRecording()
    .then(() => true)
    .catch((err) => {
      toast(errorText(err), "error");
      return false;
    });
  document.body.classList.add("is-recording");
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code !== "Space" || settingsOpen() || isTextEditing(e.target)) return;
  // Odaktaki düğme/onay kutusu Space bırakılınca tetiklenmesin.
  e.preventDefault();
  void stopRecording();
}

async function stopRecording() {
  const started = recording;
  if (!started) return;
  recording = null;
  document.body.classList.remove("is-recording");
  if (!(await started)) return;
  const part: Part = { id: nextId++, text: "", included: true, pending: true, editing: false };
  parts.push(part);
  renderParts();
  scrollPartsToEnd();
  try {
    const text = await api.stopAndTranscribe();
    if (!text.trim()) {
      parts = parts.filter((p) => p.id !== part.id);
      toast("Konuşma algılanmadı.", "info");
    } else {
      part.text = text.trim();
      part.pending = false;
    }
  } catch (err) {
    parts = parts.filter((p) => p.id !== part.id);
    toast(errorText(err), "error");
  }
  renderParts();
}

/** Sorun bildirimine eklenen teknik bilgi — dikte veya rapor içeriği yok. */
function reportDetails(): Record<string, string> {
  const whisper = modelStatus.state === "ready" ? `hazır (${backendLabel(modelStatus.backend)})` : modelStatus.state;
  const model = { anthropic: settings.anthropicModel, gemini: settings.geminiModel, openai: settings.openaiModel }[settings.provider];
  return {
    Whisper: whisper,
    "LLM sağlayıcısı": `${settings.provider} · ${model || "?"}`,
    "Şablon seçimi": templateChoice,
    "Şablon sayısı": String(settings.prompt.templates.length),
    "Parça sayısı": String(parts.length),
  };
}

// ---------- İşle / Kopyala ----------

function includedText(): string {
  return parts
    .filter((p) => p.included && !p.pending && p.text.trim())
    .map((p) => p.text.trim())
    .join("\n");
}

async function processParts() {
  const transcript = includedText();
  if (processing) return;
  if (!transcript) {
    toast("İşlenecek işaretli parça yok.", "info");
    return;
  }
  processing = true;
  editingOutput = false;
  render();
  try {
    output = await api.processReport(buildPrompt(settings.prompt, transcript, templateChoice));
  } catch (err) {
    toast(errorText(err), "error");
  } finally {
    processing = false;
    render();
  }
}

async function copyReport() {
  syncOutputEditor();
  if (!output.trim()) return;
  try {
    await api.copyReport(output);
  } catch (err) {
    toast(errorText(err), "error");
    return;
  }
  undoSnapshot = { parts: parts.filter((p) => !p.pending), output };
  parts = parts.filter((p) => p.pending);
  output = "";
  editingOutput = false;
  templateChoice = AUTO;
  toast("Rapor panoya kopyalandı; oturum temizlendi.", "success");
  render();
}

function undo() {
  if (!undoSnapshot) return;
  parts = [...undoSnapshot.parts, ...parts];
  output = undoSnapshot.output;
  undoSnapshot = null;
  toast("Son rapor ve parçaları geri getirildi.", "info");
  render();
}

async function clearSession() {
  if (!parts.length && !output) return;
  if (!(await confirmDialog("Tüm parçalar ve rapor silinsin mi? Geri alınamaz.", { confirmLabel: "Sil", danger: true }))) return;
  parts = parts.filter((p) => p.pending);
  output = "";
  editingOutput = false;
  render();
}

function toggleSelectAll() {
  const all = parts.every((p) => p.included);
  parts.forEach((p) => (p.included = !all));
  renderParts();
}

function toggleEditOutput() {
  if (editingOutput) syncOutputEditor();
  editingOutput = !editingOutput;
  renderReportPanel();
  if (editingOutput) $("report-editor")?.focus();
}

function syncOutputEditor() {
  const editor = document.getElementById("report-editor") as HTMLTextAreaElement | null;
  if (editingOutput && editor) output = editor.value;
}

// ---------- Görünüm ----------

function render() {
  renderModelStatus();
  renderTemplateChoice();
  renderParts();
  renderReportPanel();
}

/** İşle'de kullanılacak şablon: otomatik (tümü gider) veya elle seçilen tek şablon (daha az token). */
function renderTemplateChoice() {
  const templates = settings.prompt.templates.filter((t) => t.name.trim() && t.body.trim());
  if (templateChoice !== AUTO && templateChoice !== FREE && !templates.some((t) => t.tag === templateChoice)) {
    templateChoice = AUTO;
  }
  const options = [
    { value: AUTO, label: "Otomatik", hint: "tüm şablonlar" },
    ...templates.map((t) => ({ value: t.tag, label: t.name })),
    { value: FREE, label: "Şablonsuz", hint: "serbest düzeltme" },
  ];
  $("template-choice").replaceChildren(
    customSelect({
      options,
      value: templateChoice,
      searchable: options.length > 8,
      onChange: (v) => {
        templateChoice = v;
        renderTokenEstimate();
      },
    }),
  );
  renderTokenEstimate();
}

function renderTokenEstimate() {
  const tokens = estimateTokens(buildPrompt(settings.prompt, includedText(), templateChoice));
  $("token-estimate").textContent = `≈ ${tokens.toLocaleString("tr")} token`;
}

function renderModelStatus() {
  const box = $("model-status");
  box.replaceChildren(...modelStatusView(modelStatus));
  box.dataset.state = modelStatus.state;
}

function modelStatusView(s: ModelStatus): (Node | string)[] {
  switch (s.state) {
    case "checking":
      return ["Model aranıyor…"];
    case "loading":
      return [h("span", { class: "spinner" }), "Whisper yükleniyor…"];
    case "ready":
      return [h("span", { class: "dot", title: s.path }), `Whisper hazır · ${backendLabel(s.backend)}`];
    case "downloading": {
      const pct = s.total ? Math.floor((s.downloaded / s.total) * 100) : 0;
      const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
      return [
        `Model indiriliyor ${pct}%`,
        h("progress", { max: 100, value: pct }),
        h("span", { class: "muted" }, `${mb(s.downloaded)} / ${mb(s.total)} MB`),
      ];
    }
    case "missing":
      return ["Whisper modeli bulunamadı.", downloadButton("Modeli indir (~850 MB)")];
    case "error":
      return [h("span", { class: "error-text", title: s.message }, s.message), downloadButton("Yeniden indir")];
  }
}

function backendLabel(backend: string): string {
  if (/^MTL/i.test(backend)) return "Metal (GPU)";
  if (/vulkan/i.test(backend)) return "Vulkan (GPU)";
  if (/cpu/i.test(backend)) return "CPU";
  return backend;
}

function downloadButton(label: string): HTMLButtonElement {
  return h(
    "button",
    {
      class: "btn small",
      onclick: () => {
        api.downloadModel().catch((err) => toast(errorText(err), "error"));
      },
    },
    label,
  );
}

function renderParts() {
  const list = $("parts-list");
  const readyCount = parts.filter((p) => p.included && !p.pending && p.text.trim()).length;
  $("parts-count").textContent = parts.length ? `${parts.length} parça` : "";
  $("btn-select-all").hidden = parts.length < 2;
  const btn = $<HTMLButtonElement>("btn-process");
  btn.disabled = processing || readyCount === 0;
  btn.textContent = processing ? "İşleniyor…" : readyCount ? `İşle (${readyCount})` : "İşle";
  renderTokenEstimate();
  if (!parts.length) {
    list.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("div", { class: "keycap" }, "Space"),
        h("p", {}, "Basılı tutup konuşun, bırakınca parça eklenir."),
        h("p", { class: "muted" }, "Araya giren konuşmaları sonra işaretini kaldırarak ayıklayın."),
        h("p", { class: "muted" }, "Hatalı kelimeye tıklayın; birden çok kelime için sürükleyin ya da Shift ile tıklayın."),
      ),
    );
    return;
  }
  list.replaceChildren(...parts.map((p, i) => partView(p, i)));
}

function partView(p: Part, index: number): HTMLElement {
  const cls = `part${p.included ? "" : " excluded"}${p.pending ? " pending" : ""}`;
  const toggle = h("input", {
    type: "checkbox",
    checked: p.included,
    disabled: p.pending,
    title: "Rapora dahil et",
    onchange: (e: Event) => {
      p.included = (e.target as HTMLInputElement).checked;
      renderParts();
    },
  });
  const body = p.pending
    ? h("div", { class: "part-text" }, h("span", { class: "spinner" }), " Çözümleniyor…")
    : p.editing
      ? partEditor(p)
      : wordText(p);
  const actions = p.pending
    ? null
    : h(
        "div",
        { class: "part-actions" },
        p.editing
          ? iconButton("check", "Kaydet (⌘/Ctrl+Enter)", () => finishEdit(p))
          : iconButton("pencil", "Tümünü düzenle", () => startEdit(p)),
        iconButton("trash", "Sil", () => removePart(p), "danger"),
      );
  return h("div", { class: cls }, h("label", { class: "part-check" }, toggle, h("span", { class: "part-no" }, String(index + 1))), body, actions);
}

const ICONS = {
  pencil: '<path d="M11.5 2.5l2 2L6 12H4v-2z"/><path d="M10 4l2 2"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
};

function iconButton(icon: keyof typeof ICONS, title: string, onclick: () => void, extra = ""): HTMLButtonElement {
  const btn = h("button", { class: `icon-btn ${extra}`, title, "aria-label": title, onclick });
  // Sabit, uygulamaya gömülü SVG yolları; kullanıcı verisi içermez.
  btn.innerHTML = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</svg>`;
  return btn;
}

function partEditor(p: Part): HTMLTextAreaElement {
  const ta = h("textarea", { class: "part-editor", rows: 3, value: p.text });
  ta.addEventListener("input", () => (p.text = ta.value));
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopPropagation();
      finishEdit(p);
    } else if (e.key === "Escape") {
      finishEdit(p);
    }
  });
  queueMicrotask(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  });
  return ta;
}

function startEdit(p: Part) {
  parts.forEach((x) => (x.editing = false));
  p.editing = true;
  renderParts();
}

function finishEdit(p: Part) {
  p.editing = false;
  p.text = p.text.trim();
  if (!p.text) parts = parts.filter((x) => x !== p);
  renderParts();
}

function removePart(p: Part) {
  parts = parts.filter((x) => x !== p);
  renderParts();
}

function scrollPartsToEnd() {
  const list = $("parts-list");
  list.scrollTop = list.scrollHeight;
}

function renderReportPanel() {
  const view = $("report-view");
  $<HTMLButtonElement>("btn-copy").disabled = !output.trim() || processing;
  $<HTMLButtonElement>("btn-edit").disabled = !output.trim() || processing;
  $("btn-edit").textContent = editingOutput ? "Önizle" : "Düzenle";
  $("btn-undo").hidden = !undoSnapshot;
  $<HTMLButtonElement>("btn-clear").disabled = !parts.length && !output;
  if (processing) {
    view.replaceChildren(h("div", { class: "empty" }, h("span", { class: "spinner large" }), h("p", {}, "Rapor hazırlanıyor…")));
    return;
  }
  if (!output) {
    view.replaceChildren(
      h(
        "div",
        { class: "empty" },
        h("p", {}, "İşaretli parçalar “İşle” ile tek seferde rapora dönüştürülür."),
        h("p", { class: "muted" }, "Pozitif bulgular kalın gösterilir; Kopyala panoya RTF olarak yazar."),
      ),
    );
    return;
  }
  if (editingOutput) {
    const ta = h("textarea", { id: "report-editor", class: "report-editor", value: output, spellcheck: false });
    ta.addEventListener("input", () => (output = ta.value));
    view.replaceChildren(ta);
    return;
  }
  const doc = h("div", { class: "report-doc" });
  doc.innerHTML = renderReport(output);
  view.replaceChildren(doc);
}

let toastTimer: number | undefined;
function toast(message: string, kind: "info" | "error" | "success") {
  const el = $("toast");
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), kind === "error" ? 7000 : 3200);
}

void init();
