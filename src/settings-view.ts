import { api, errorText } from "./api";
import { h } from "./dom";
import { buildPromptTemplate, makeTag } from "./prompt";
import { customSelect, type SelectOption } from "./select";
import { enableDragSort } from "./drag-sort";
import { checkForUpdates } from "./updater";
import { alertDialog, confirmDialog } from "./dialog";
import { getVersion } from "@tauri-apps/api/app";
import type { ModelChoice, ModelInfo, PromptConfig, Provider, Settings, Template } from "./types";

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

const WHISPER_LANGUAGES: SelectOption[] = [
  { value: "tr", label: "Türkçe", hint: "varsayılan" },
  { value: "auto", label: "Otomatik algıla" },
  { value: "en", label: "İngilizce" },
];

const PROVIDER_NAMES: Record<Provider, string> = { anthropic: "Anthropic", gemini: "Google Gemini", openai: "OpenAI-uyumlu" };

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
const keyTimers = new Map<Provider, number>();
/** Bu çizimdeki model alanları; model listesi gelince yalnızca bunlar yenilenir. */
let modelSlots: { choice: ModelChoice; slot: HTMLElement }[] = [];

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
  if (!draft.modelChain?.length) draft.modelChain = [{ provider: draft.provider, model: modelOf(draft, draft.provider) }];
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
  // Eski tek sağlayıcı alanları sıranın ilkini göstersin (sorun bildirimi vb.).
  draft.modelChain = draft.modelChain.filter((c) => c.model.trim());
  const first = draft.modelChain[0];
  if (first) {
    draft.provider = first.provider;
    setModelOf(draft, first.provider, first.model);
  }
  try {
    await api.saveSettings(draft);
    onSaved(structuredClone(draft));
    close();
  } catch (err) {
    await alertDialog(`Ayarlar kaydedilemedi: ${errorText(err)}`);
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

function checkbox(value: boolean, set: (v: boolean) => void): HTMLInputElement {
  const el = h("input", { type: "checkbox", checked: value });
  el.addEventListener("change", () => set(el.checked));
  return el;
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
  const chain = s.modelChain;
  modelSlots = [];
  const move = (from: number, to: number) => {
    const [c] = chain.splice(from, 1);
    chain.splice(to, 0, c);
    render();
  };
  const add = () => {
    const unused = PROVIDERS.map((o) => o.value as Provider).find((p) => !chain.some((c) => c.provider === p)) ?? "anthropic";
    chain.push({ provider: unused, model: FALLBACK_MODELS[unused][0]?.value ?? "" });
    render();
  };
  const items = h("div", { class: "chain-items" }, ...chain.map((c, i) => chainRow(s, c, i)));
  enableDragSort(items, ".chain-item", move, ".grip");
  const used = PROVIDERS.map((o) => o.value as Provider).filter((p) => chain.some((c) => c.provider === p));
  const out: Node[] = [
    h("h3", {}, "Model sırası"),
    h("p", { class: "hint" }, "“İşle” önce 1. modeli dener. Hata verirse (kota dolması, bağlantı, anahtar ya da sunucu hatası) sıradakine geçer. Sıralamak için ⠿ tutamacından sürükleyin."),
    items,
    h("div", {}, h("button", { class: "btn small", onclick: add }, "+ Model ekle")),
    h("h3", {}, "API anahtarları"),
  ];
  for (const p of used) out.push(...keyFields(s, p));
  out.push(h("p", { class: "hint" }, "Anahtarlar bu bilgisayardaki ayar dosyasında düz metin olarak saklanır. Kayıt sırasında hiçbir LLM çağrısı yapılmaz; yalnızca “İşle” istek gönderir."));
  for (const entry of modelSlots) renderModelSlot(s, entry);
  for (const p of used) if (keyOf(s, p).trim() && !modelLists.has(listKey(s, p))) void fetchModels(s, p);
  return out;
}

function chainRow(s: Settings, c: ModelChoice, i: number): HTMLElement {
  const slot = h("div", { class: "chain-model" });
  modelSlots.push({ choice: c, slot });
  const provider = customSelect({
    options: PROVIDERS,
    value: c.provider,
    className: "chain-provider",
    onChange: (v) => {
      c.provider = v as Provider;
      c.model = FALLBACK_MODELS[c.provider][0]?.value ?? "";
      render();
    },
  });
  const remove = h("button", { class: "icon-btn danger", title: "Sıradan çıkar", disabled: s.modelChain.length === 1 }, "✕");
  remove.addEventListener("click", () => {
    s.modelChain.splice(s.modelChain.indexOf(c), 1);
    render();
  });
  return h(
    "div",
    { class: "chain-item" },
    h("span", { class: "grip", title: "Sıralamak için sürükleyin", "aria-hidden": "true" }, "⠿"),
    h("span", { class: "tpl-no" }, String(i + 1)),
    provider,
    slot,
    remove,
  );
}

function keyFields(s: Settings, p: Provider): Node[] {
  const onKeyChange = () => {
    window.clearTimeout(keyTimers.get(p));
    keyTimers.set(p, window.setTimeout(() => void fetchModels(s, p), 700));
  };
  const out: Node[] = [];
  if (p === "openai") {
    out.push(
      field(
        "OpenAI-uyumlu temel adres",
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
      `${PROVIDER_NAMES[p]} API anahtarı`,
      textInput(
        keyOf(s, p),
        (v) => {
          setKeyOf(s, p, v);
          onKeyChange();
        },
        { type: "password", placeholder: p === "anthropic" ? "sk-ant-…" : "" },
      ),
    ),
  );
  const status = h("span", { "data-model-status": p });
  updateStatus(s, p, status);
  out.push(status);
  return out;
}

function keyOf(s: Settings, p: Provider): string {
  return { anthropic: s.anthropicKey, gemini: s.geminiKey, openai: s.openaiKey }[p];
}

function setKeyOf(s: Settings, p: Provider, v: string) {
  if (p === "gemini") s.geminiKey = v;
  else if (p === "openai") s.openaiKey = v;
  else s.anthropicKey = v;
}

function modelOf(s: Settings, p: Provider): string {
  return { anthropic: s.anthropicModel, gemini: s.geminiModel, openai: s.openaiModel }[p];
}

function setModelOf(s: Settings, p: Provider, v: string) {
  if (p === "gemini") s.geminiModel = v;
  else if (p === "openai") s.openaiModel = v;
  else s.anthropicModel = v;
}

function listKey(s: Settings, p: Provider): string {
  const base = p === "openai" ? s.openaiBaseUrl.trim() : "";
  return `${p}|${base}|${keyOf(s, p).trim()}`;
}

async function fetchModels(s: Settings, p: Provider) {
  const key = listKey(s, p);
  if (!keyOf(s, p).trim()) return refreshSlots(s, p);
  modelLists.set(key, { status: "loading", models: [] });
  refreshSlots(s, p);
  try {
    const models = await api.listModels(p, keyOf(s, p), s.openaiBaseUrl);
    modelLists.set(key, { status: "ok", models });
  } catch (err) {
    modelLists.set(key, { status: "error", models: [], error: errorText(err) });
  }
  // Bu arada anahtar değiştiyse eski sonucu gösterme.
  if (draft === s && listKey(s, p) === key) refreshSlots(s, p);
}

function refreshSlots(s: Settings, p: Provider) {
  for (const entry of modelSlots) if (entry.choice.provider === p && entry.slot.isConnected) renderModelSlot(s, entry);
  const status = document.querySelector<HTMLElement>(`[data-model-status="${p}"]`);
  if (status) updateStatus(s, p, status);
}

function updateStatus(s: Settings, p: Provider, el: HTMLElement) {
  el.textContent = modelListStatus(s, p);
  el.className = modelLists.get(listKey(s, p))?.status === "error" ? "hint warn" : "hint";
}

function modelListStatus(s: Settings, p: Provider): string {
  const list = modelLists.get(listKey(s, p));
  if (!keyOf(s, p).trim()) return "Anahtarı girince sağlayıcının modelleri listelenir.";
  if (!list || list.status === "loading") return "Modeller alınıyor…";
  if (list.status === "error") return `Model listesi alınamadı: ${list.error} — model adını elle yazabilirsiniz.`;
  return `${list.models.length} model listelendi. Listede yoksa adı elle yazabilirsiniz.`;
}

function renderModelSlot(s: Settings, { choice, slot }: { choice: ModelChoice; slot: HTMLElement }) {
  const list = modelLists.get(listKey(s, choice.provider));
  const fetched = list?.status === "ok" && list.models.length > 0;
  const options: SelectOption[] = fetched
    ? list.models.map((m) => ({ value: m.id, label: m.label, hint: m.label !== m.id ? m.id : undefined }))
    : FALLBACK_MODELS[choice.provider];
  slot.replaceChildren(
    customSelect({
      options,
      value: choice.model,
      onChange: (v) => (choice.model = v),
      editable: true,
      placeholder: "model adı",
      emptyText: "Eşleşen model yok — yazdığınız ad kullanılır.",
    }),
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
  const remove = async () => {
    if (!(await confirmDialog(`“${t.name}” şablonu silinsin mi? (Ayarları kaydetmeden çıkarsanız geri gelir.)`, { confirmLabel: "Sil", danger: true }))) return;
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
    h("div", { class: "row-end" }, h("button", { class: "btn ghost danger small", onclick: () => void remove() }, "Şablonu sil")),
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
  const langs: SelectOption[] = [...WHISPER_LANGUAGES];
  if (!langs.some((l) => l.value === s.whisperLanguage)) langs.push({ value: s.whisperLanguage, label: s.whisperLanguage });
  return [
    h("h3", {}, "Whisper"),
    h("p", { class: "hint" }, "Model: whisper-large-v3-turbo Q8_0 (yerel)."),
    field("Dikte dili", select(langs, s.whisperLanguage, (v) => (s.whisperLanguage = v)), "Otomatik algılama her kayıtta dili yeniden tahmin eder; kısa ya da terim yoğun diktede yanlış dile kayabilir."),
    field("Başlangıç bağlamı (initial prompt)", ta),
    counter,
    h("p", { class: "hint" }, "Talimat değil, bağlamdır: doktorun dikte üslubuna benzeyen örnek rapor cümleleri ve sık terimler yazın. Whisper bunları “daha önce söylenmiş” sayar ve yazımı onlara yaklaştırır."),
    h("label", { class: "check-row" }, checkbox(s.whisperStrict, (v) => (s.whisperStrict = v)), h("span", {}, "Kararlı çözümleme (deneysel)")),
    h("p", { class: "hint" }, "Her parça tek seferde, rastgelelik olmadan çözümlenir; kısık ya da gürültülü seste başka dilde metin yerine “Anlaşılamadı” uyarısı çıkar ve parça eklenmez. Kötü seste daha hızlıdır; nadiren, varsayılan modun ikinci denemede kurtardığı bir parçayı tekrar söylemeniz gerekebilir."),
    h("label", { class: "check-row" }, checkbox(s.soundFeedback, (v) => (s.soundFeedback = v)), h("span", {}, "Kayıt başlarken ve biterken kısa ses çal")),
    h("h3", {}, "Mikrofon"),
    field("Giriş aygıtı", select(mics, s.microphone ?? "", (v) => (s.microphone = v || null))),
  ];
}

function rulesTab(p: PromptConfig): Node[] {
  const resetAll = async () => {
    const ok = await confirmDialog("Şablonlar, kısaltmalar, yazım sözlüğü ve tüm talimatlar başlangıç değerlerine dönsün mü?", { confirmLabel: "Döndür", danger: true });
    if (!ok) return;
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
    h("label", { class: "check-row" }, toggle, h("span", {}, "Güncellemeleri otomatik indir (GitHub Releases)")),
    h("p", { class: "hint" }, "Açılışta ve 6 saatte bir denetlenir; yeni sürüm arka planda iner, kurulum üst çubuktaki “Yeniden başlat” ile yapılır. Hiçbir dikte veya rapor gönderilmez. Güncelleme imzalıdır; imza tutmazsa kurulmaz."),
    h("button", { class: "btn small", onclick: () => void checkForUpdates(true) }, "Şimdi denetle"),
    h("h3", {}, "Tepsi"),
    h("p", { class: "hint" }, "Pencereyi kapatmak uygulamayı kapatmaz; Hilus sistem tepsisinde (macOS'ta menü çubuğunda) çalışmayı sürdürür ve oturum bellekte kalır. Tamamen kapatmak için tepsi menüsünden “Çık”."),
  ];
}
