import { api, errorText } from "./api";
import { h } from "./dom";
import { buildPromptTemplate, makeTag } from "./prompt";
import { customSelect, type SelectOption } from "./select";
import { enableDragSort } from "./drag-sort";
import { checkForUpdates } from "./updater";
import { getVersion } from "@tauri-apps/api/app";
import type { ModelInfo, PromptConfig, Provider, Settings, Template } from "./types";

type Tab = "ai" | "templates" | "spelling" | "whisper" | "rules" | "preview" | "app";

const TABS: [Tab, string][] = [
  ["ai", "Yapay zekâ"],
  ["templates", "Şablonlar"],
  ["spelling", "Yazım sözlüğü"],
  ["whisper", "Whisper ve mikrofon"],
  ["rules", "Genel talimatlar"],
  ["preview", "Prompt önizleme"],
  ["app", "Uygulama"],
];

/** Model listesi çekilemezse önerilecek modeller. */
const FALLBACK_MODELS: Record<Provider, SelectOption[]> = {
  anthropic: [
    { value: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "hızlı, ucuz" },
    { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "daha güçlü" },
  ],
  gemini: [{ value: "gemini-3.6-flash", label: "gemini-3.6-flash" }],
  openai: [],
};

const PROVIDERS: SelectOption[] = [
  { value: "anthropic", label: "Anthropic", hint: "Claude" },
  { value: "gemini", label: "Google Gemini" },
  { value: "openai", label: "OpenAI-uyumlu", hint: "genel" },
];

interface ModelList {
  status: "loading" | "ok" | "error";
  models: ModelInfo[];
  error?: string;
}

/** Sağlayıcı+anahtar başına çekilmiş model listeleri (yalnızca bellekte). */
const modelLists = new Map<string, ModelList>();
let keyTimer: number | undefined;

const WHISPER_TOKEN_LIMIT = 220;

let draft: Settings | null = null;
let tab: Tab = "ai";
let selectedTemplate = 0;
let microphones: string[] = [];
let onSaved: (s: Settings) => void = () => {};

export function settingsOpen(): boolean {
  return draft !== null;
}

export function openSettings(current: Settings, saved: (s: Settings) => void) {
  draft = structuredClone(current);
  onSaved = saved;
  selectedTemplate = 0;
  api
    .listMicrophones()
    .then((list) => {
      microphones = list;
      if (tab === "whisper") render();
    })
    .catch(() => {});
  document.getElementById("settings")!.hidden = false;
  render();
}

function close() {
  draft = null;
  document.getElementById("settings")!.hidden = true;
}

async function save() {
  if (!draft) return;
  try {
    await api.saveSettings(draft);
    onSaved(structuredClone(draft));
    close();
  } catch (err) {
    alert(`Ayarlar kaydedilemedi: ${errorText(err)}`);
  }
}

function render() {
  if (!draft) return;
  const root = document.getElementById("settings")!;
  const nav = h(
    "nav",
    { class: "settings-nav" },
    ...TABS.map(([id, label]) =>
      h(
        "button",
        {
          class: `nav-item${tab === id ? " active" : ""}`,
          onclick: () => {
            tab = id;
            render();
          },
        },
        label,
      ),
    ),
  );
  const body = h("div", { class: "settings-body" }, ...tabContent(draft));
  const footer = h(
    "footer",
    { class: "settings-footer" },
    h("span", { class: "muted" }, "Yalnızca ayarlar diske kaydedilir; dikte ve raporlar asla."),
    h("div", { class: "spacer" }),
    h("button", { class: "btn ghost", onclick: close }, "Vazgeç"),
    h("button", { class: "btn primary", onclick: () => void save() }, "Kaydet"),
  );
  root.replaceChildren(
    h(
      "div",
      { class: "settings-card" },
      h("header", { class: "settings-header" }, h("h2", {}, "Ayarlar")),
      h("div", { class: "settings-main" }, nav, body),
      footer,
    ),
  );
}

function tabContent(s: Settings): Node[] {
  switch (tab) {
    case "ai":
      return aiTab(s);
    case "templates":
      return templatesTab(s.prompt);
    case "spelling":
      return spellingTab(s.prompt);
    case "whisper":
      return whisperTab(s);
    case "rules":
      return rulesTab(s.prompt);
    case "preview":
      return previewTab(s.prompt);
    case "app":
      return appTab(s);
  }
}

// ---------- Form yardımcıları ----------

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "hint" }, hint) : null);
}

function textInput(value: string, set: (v: string) => void, attrs: Record<string, string> = {}): HTMLInputElement {
  const el = h("input", { type: "text", value, spellcheck: false, ...attrs });
  el.addEventListener("input", () => set(el.value));
  return el;
}

function textArea(value: string, set: (v: string) => void, rows: number, mono = false): HTMLTextAreaElement {
  const el = h("textarea", { rows, value, spellcheck: false, class: mono ? "mono" : "" });
  el.addEventListener("input", () => set(el.value));
  return el;
}

function select(options: SelectOption[], value: string, set: (v: string) => void): HTMLElement {
  return customSelect({ options, value, onChange: set, searchable: options.length > 8 });
}

// ---------- Sekmeler ----------

function aiTab(s: Settings): Node[] {
  const provider = select(PROVIDERS, s.provider, (v) => {
    s.provider = v as Provider;
    render();
  });
  const conn = connection(s);
  const modelSlot = h("div", { class: "model-slot" });
  const onKeyChange = () => {
    window.clearTimeout(keyTimer);
    keyTimer = window.setTimeout(() => void fetchModels(s, modelSlot), 700);
  };
  const out: Node[] = [h("h3", {}, "Yapay zekâ sağlayıcısı"), field("1. Sağlayıcı", provider)];
  if (s.provider === "openai") {
    out.push(
      field(
        "Temel adres",
        textInput(s.openaiBaseUrl, (v) => {
          s.openaiBaseUrl = v;
          onKeyChange();
        }),
        "…/v1 biçiminde; istekler {adres}/chat/completions ve {adres}/models'e gider.",
      ),
    );
  }
  out.push(
    field(
      "2. API anahtarı",
      textInput(
        conn.key,
        (v) => {
          conn.setKey(v);
          onKeyChange();
        },
        { type: "password", placeholder: s.provider === "anthropic" ? "sk-ant-…" : "" },
      ),
    ),
    modelSlot,
    h("p", { class: "hint" }, "Anahtar bu bilgisayardaki ayar dosyasında düz metin olarak saklanır. Kayıt sırasında hiçbir LLM çağrısı yapılmaz; yalnızca “İşle” tek istek gönderir."),
  );
  renderModelField(s, modelSlot);
  if (conn.key.trim() && !modelLists.has(listKey(s))) void fetchModels(s, modelSlot);
  return out;
}

function connection(s: Settings) {
  switch (s.provider) {
    case "gemini":
      return { key: s.geminiKey, setKey: (v: string) => (s.geminiKey = v), model: s.geminiModel, setModel: (v: string) => (s.geminiModel = v) };
    case "openai":
      return { key: s.openaiKey, setKey: (v: string) => (s.openaiKey = v), model: s.openaiModel, setModel: (v: string) => (s.openaiModel = v) };
    default:
      return { key: s.anthropicKey, setKey: (v: string) => (s.anthropicKey = v), model: s.anthropicModel, setModel: (v: string) => (s.anthropicModel = v) };
  }
}

function listKey(s: Settings): string {
  const base = s.provider === "openai" ? s.openaiBaseUrl.trim() : "";
  return `${s.provider}|${base}|${connection(s).key.trim()}`;
}

async function fetchModels(s: Settings, slot: HTMLElement) {
  const key = listKey(s);
  const conn = connection(s);
  if (!conn.key.trim()) return renderModelField(s, slot);
  modelLists.set(key, { status: "loading", models: [] });
  renderModelField(s, slot);
  try {
    const models = await api.listModels(s.provider, conn.key, s.openaiBaseUrl);
    modelLists.set(key, { status: "ok", models });
  } catch (err) {
    modelLists.set(key, { status: "error", models: [], error: errorText(err) });
  }
  // Bu arada sağlayıcı/anahtar değiştiyse eski sonucu gösterme.
  if (slot.isConnected && draft === s && listKey(s) === key) renderModelField(s, slot);
}

function renderModelField(s: Settings, slot: HTMLElement) {
  const conn = connection(s);
  const list = modelLists.get(listKey(s));
  const fetched = list?.status === "ok" && list.models.length > 0;
  const options: SelectOption[] = fetched
    ? list.models.map((m) => ({ value: m.id, label: m.label, hint: m.label !== m.id ? m.id : undefined }))
    : FALLBACK_MODELS[s.provider];
  let status: string;
  let cls = "hint";
  if (!conn.key.trim()) status = "Anahtarı girince sağlayıcının modelleri listelenir.";
  else if (!list || list.status === "loading") status = "Modeller alınıyor…";
  else if (list.status === "error") {
    status = `Model listesi alınamadı: ${list.error} — model adını elle yazabilirsiniz.`;
    cls = "hint warn";
  } else status = `${list.models.length} model listelendi. Listede yoksa adı elle yazabilirsiniz.`;
  slot.replaceChildren(
    field(
      "3. Model",
      customSelect({
        options,
        value: conn.model,
        onChange: conn.setModel,
        editable: true,
        placeholder: "model adı",
        emptyText: "Eşleşen model yok — yazdığınız ad kullanılır.",
      }),
    ),
    h("span", { class: cls }, status),
  );
}

function templatesTab(p: PromptConfig): Node[] {
  const list = p.templates;
  selectedTemplate = Math.min(selectedTemplate, Math.max(0, list.length - 1));
  const move = (from: number, to: number) => {
    const current = list[selectedTemplate];
    const [t] = list.splice(from, 1);
    list.splice(to, 0, t);
    selectedTemplate = list.indexOf(current);
    render();
  };
  const add = () => {
    const tag = makeTag("yeni", list.map((t) => t.tag));
    list.push({ tag, name: "Yeni şablon", keywords: [], body: "ACİL … BT İNCELEMESİ\n\nKlinik bilgi: {klinik bilgi}\n\nBulgular:\n\nDr.", abbreviations: "" });
    selectedTemplate = list.length - 1;
    render();
  };
  const items = h(
    "div",
    { class: "tpl-items" },
    ...list.map((t, i) =>
      h(
        "div",
        {
          class: `tpl-item${i === selectedTemplate ? " active" : ""}`,
          title: "Sıralamak için sürükleyin",
          onclick: () => {
            selectedTemplate = i;
            render();
          },
        },
        h("span", { class: "grip", "aria-hidden": "true" }, "⠿"),
        h("span", { class: "tpl-no" }, String(i + 1)),
        h("span", { class: "tpl-name" }, t.name),
      ),
    ),
  );
  enableDragSort(items, ".tpl-item", move);
  const sidebar = h(
    "div",
    { class: "tpl-list" },
    h("p", { class: "hint" }, "Sürükleyerek sıralayın. Sıra önceliktir: Otomatik modda dikte başındaki sözler yukarıdan aşağıya ilk eşleşen şablonu seçer."),
    items,
    h("button", { class: "btn small", onclick: add }, "+ Şablon ekle"),
  );
  const t = list[selectedTemplate];
  const editor = t ? templateEditor(t, list) : h("p", { class: "muted" }, "Şablon yok.");
  return [h("h3", {}, "Şablonlar"), h("div", { class: "tpl-layout" }, sidebar, editor)];
}

function templateEditor(t: Template, list: Template[]): HTMLElement {
  const remove = () => {
    if (!confirm(`“${t.name}” şablonu silinsin mi?`)) return;
    list.splice(list.indexOf(t), 1);
    render();
  };
  return h(
    "div",
    { class: "tpl-editor" },
    field("Ad", textInput(t.name, (v) => (t.name = v)), `Prompt etiketi: <${t.tag}>`),
    field(
      "Anahtar sözler",
      textInput(t.keywords.join(", "), (v) => (t.keywords = v.split(",").map((k) => k.trim()).filter(Boolean))),
      "Virgülle ayırın. Dikte bu sözlerden biriyle başlarsa bu şablon seçilir.",
    ),
    field("Şablon metni", textArea(t.body, (v) => (t.body = v), 16, true), "{...} süslü parantezler modele talimattır, çıktıda kalmaz."),
    field("Kısaltmalar", textArea(t.abbreviations, (v) => (t.abbreviations = v), 7, true), "Her satır: - \"söylenen\" → Rapordaki tam cümle."),
    h("div", { class: "row-end" }, h("button", { class: "btn ghost danger small", onclick: remove }, "Şablonu sil")),
  );
}

function spellingTab(p: PromptConfig): Node[] {
  const rows = p.spelling.map((entry, i) =>
    h(
      "div",
      { class: "spell-row" },
      textInput(entry.from, (v) => (entry.from = v), { placeholder: "duyulan / yanlış yazım" }),
      h("span", { class: "arrow" }, "→"),
      textInput(entry.to, (v) => (entry.to = v), { placeholder: "doğru yazım" }),
      h(
        "button",
        {
          class: "icon-btn",
          title: "Sil",
          onclick: () => {
            p.spelling.splice(i, 1);
            render();
          },
        },
        "×",
      ),
    ),
  );
  return [
    h("h3", {}, "Yazım sözlüğü"),
    h("p", { class: "hint" }, "Bu kelimeler her zaman sağdaki yazımla yazılır; şablon metinleri dahil tüm kurallardan önce gelir."),
    ...rows,
    h(
      "button",
      {
        class: "btn small",
        onclick: () => {
          p.spelling.push({ from: "", to: "" });
          render();
        },
      },
      "+ Kelime ekle",
    ),
  ];
}

function whisperTab(s: Settings): Node[] {
  const counter = h("span", { class: "hint" });
  const updateCounter = () => {
    const tokens = Math.ceil(s.whisperPrompt.trim().length / 2.6);
    counter.textContent = `${s.whisperPrompt.trim().length} karakter · yaklaşık ${tokens} token (sınır ≈ ${WHISPER_TOKEN_LIMIT}; aşan kısımda yalnızca sondaki metin kullanılır)`;
    counter.classList.toggle("warn", tokens > WHISPER_TOKEN_LIMIT);
  };
  const ta = textArea(
    s.whisperPrompt,
    (v) => {
      s.whisperPrompt = v;
      updateCounter();
    },
    8,
  );
  updateCounter();
  const mics: SelectOption[] = [{ value: "", label: "Sistem varsayılanı" }, ...microphones.map((m) => ({ value: m, label: m }))];
  if (s.microphone && !microphones.includes(s.microphone)) mics.push({ value: s.microphone, label: s.microphone, hint: "bağlı değil" });
  return [
    h("h3", {}, "Whisper"),
    h("p", { class: "hint" }, "Dil sabit: Türkçe. Model: whisper-large-v3-turbo Q8_0 (yerel)."),
    field("Başlangıç bağlamı (initial prompt)", ta),
    counter,
    h("p", { class: "hint" }, "Talimat değil, bağlamdır: doktorun dikte üslubuna benzeyen örnek rapor cümleleri ve sık terimler yazın. Whisper bunları “daha önce söylenmiş” sayar ve yazımı onlara yaklaştırır."),
    h("h3", {}, "Mikrofon"),
    field("Giriş aygıtı", select(mics, s.microphone ?? "", (v) => (s.microphone = v || null))),
  ];
}

function rulesTab(p: PromptConfig): Node[] {
  const resetAll = async () => {
    if (!confirm("Şablonlar, kısaltmalar, yazım sözlüğü ve tüm talimatlar başlangıç değerlerine dönsün mü?")) return;
    if (!draft) return;
    draft.prompt = await api.defaultPromptConfig();
    render();
  };
  const area = (label: string, key: keyof PromptConfig, rows: number) =>
    field(label, textArea(p[key] as string, (v) => ((p[key] as string) = v), rows));
  return [
    h("h3", {}, "Genel talimatlar"),
    h("p", { class: "hint" }, "Prompt bu parçalar, şablonlar ve yazım sözlüğünden birleştirilir. Şablon listesi ve kısaltmalar otomatik eklenir."),
    area("Giriş", "intro", 4),
    area("Mod seçimi — açıklama", "modeIntro", 3),
    area("Mod seçimi — eşleşme yoksa", "modeFallback", 2),
    area("Şablon modu kuralları", "templateRules", 14),
    area("Kısaltma sözlüğü — açıklama", "abbreviationsIntro", 2),
    area("Yazım sözlüğü — açıklama", "spellingIntro", 3),
    area("Yazım sözlüğü — boşken", "spellingEmpty", 2),
    area("Genel kurallar", "generalRules", 10),
    area("Çıktı kuralı", "outputRule", 4),
    h("div", { class: "row-end" }, h("button", { class: "btn ghost danger small", onclick: () => void resetAll() }, "Tümünü başlangıç değerlerine döndür")),
  ];
}

function previewTab(p: PromptConfig): Node[] {
  const text = buildPromptTemplate(p);
  return [
    h("h3", {}, "Prompt önizleme"),
    h("p", { class: "hint" }, `${text.length.toLocaleString("tr")} karakter. “İşle”de \${output} yerine işaretli parçalar sırayla konur.`),
    h("textarea", { class: "mono preview", rows: 30, readonly: true, value: text, spellcheck: false }),
  ];
}

function appTab(s: Settings): Node[] {
  const version = h("span", { class: "muted" }, "…");
  getVersion()
    .then((v) => (version.textContent = `v${v}`))
    .catch(() => {});
  const toggle = h("input", { type: "checkbox", checked: s.autoUpdateCheck });
  toggle.addEventListener("change", () => (s.autoUpdateCheck = toggle.checked));
  return [
    h("h3", {}, "Uygulama"),
    h("p", {}, "Hilus ", version),
    h("label", { class: "check-row" }, toggle, h("span", {}, "Açılışta güncellemeleri denetle (GitHub Releases)")),
    h("p", { class: "hint" }, "Denetim yalnızca sürüm bilgisini (latest.json) indirir; hiçbir dikte veya rapor gönderilmez. Güncelleme imzalıdır; imza tutmazsa kurulmaz."),
    h("button", { class: "btn small", onclick: () => void checkForUpdates(true) }, "Şimdi denetle"),
    h("h3", {}, "Tepsi"),
    h("p", { class: "hint" }, "Pencereyi kapatmak uygulamayı kapatmaz; Hilus sistem tepsisinde (macOS'ta menü çubuğunda) çalışmayı sürdürür ve oturum bellekte kalır. Tamamen kapatmak için tepsi menüsünden “Çık”."),
  ];
}
