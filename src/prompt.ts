import type { PromptConfig, Template } from "./types";

const PLACEHOLDER = "${output}";

/** İşle'de şablon seçimi: otomatik (tümü), şablonsuz ya da tek bir şablonun etiketi. */
export const AUTO = "__auto__";
export const FREE = "__free__";

/**
 * Ayarlardaki parçalardan LLM prompt'unu birleştirir; `${output}` dikte metni için yer tutucudur.
 * Şablon elle seçildiyse yalnızca o şablon gönderilir (daha az token).
 */
export function buildPromptTemplate(c: PromptConfig, choice: string = AUTO): string {
  const all = c.templates.filter((t) => t.name.trim() && t.body.trim());
  if (choice === FREE) return join(c, [FREE_MODE_SECTION]);
  const chosen = all.find((t) => t.tag === choice);
  const templates = chosen ? [chosen] : all;
  const mode = chosen ? pinnedModeSection(chosen) : autoModeSection(c, all);
  const abbreviations = templates
    .filter((t) => t.abbreviations.trim())
    .map((t) => `${t.name}:\n${t.abbreviations.trim()}`)
    .join("\n");
  const blocks = templates.map((t) => `<${t.tag}>\n${t.body.trim()}\n</${t.tag}>`).join("\n\n");
  return join(c, [
    mode,
    `ŞABLON MODU\n${c.templateRules.trim()}`,
    abbreviations ? `KISALTMA SÖZLÜĞÜ ${c.abbreviationsIntro.trim()}\n${abbreviations}` : "",
    blocks,
  ]);
}

function autoModeSection(c: PromptConfig, templates: Template[]): string {
  const list = templates
    .map((t, i) => `${i + 1}. ${t.keywords.map((k) => `"${k}"`).join(" / ")} → ${t.tag}`)
    .join("\n");
  return `MOD SEÇİMİ\n${c.modeIntro.trim()}\n${list}\n${c.modeFallback.trim()}`;
}

function pinnedModeSection(t: Template): string {
  return `MOD SEÇİMİ\nRadyolog bu rapor için şablonu kendisi seçti: ${t.tag}. Dikte başındaki sözlere bakmadan bu şablonu kullan.`;
}

const FREE_MODE_SECTION =
  'MOD SEÇİMİ\nRadyolog şablonsuz rapor istedi: SERBEST MOD. Metni yalnızca "Genel kurallar"a göre düzelt, şablon kullanma ve ** işareti koyma.';

function join(c: PromptConfig, middle: string[]): string {
  const spelling = c.spelling.filter((s) => s.from.trim() && s.to.trim());
  const spellingList = spelling.length
    ? spelling.map((s) => `- "${s.from.trim()}" → ${s.to.trim()}`).join("\n")
    : c.spellingEmpty;
  return [
    c.intro.trim(),
    ...middle,
    `YAZIM SÖZLÜĞÜ\n${c.spellingIntro.trim()}\n${spellingList}`,
    `GENEL KURALLAR (her iki mod)\n${c.generalRules.trim()}`,
    `<transkript>\n${PLACEHOLDER}\n</transkript>`,
    `ÇIKTI: ${c.outputRule.trim()}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildPrompt(c: PromptConfig, transcript: string, choice: string = AUTO): string {
  // split/join: dikte metnindeki `$` karakterleri replace kalıbı olarak yorumlanmasın.
  return buildPromptTemplate(c, choice).split(PLACEHOLDER).join(transcript);
}

/** Kaba token tahmini (Türkçe metinde ~3 karakter/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

const TR_MAP: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };

/** Şablon adından prompt etiketi üretir: "Diz MR" → "sablon_diz_mr". */
export function makeTag(name: string, taken: string[]): string {
  const slug = name
    .toLocaleLowerCase("tr")
    .replace(/[çğıöşüâîû]/g, (ch) => TR_MAP[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const base = `sablon_${slug || "yeni"}`;
  let tag = base;
  for (let i = 2; taken.includes(tag); i++) tag = `${base}_${i}`;
  return tag;
}
