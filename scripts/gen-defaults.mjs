// docs/handy-radyoloji-prompt.txt dosyasını parçalara ayırıp
// src-tauri/defaults/prompt-defaults.json üretir (ayarların başlangıç değerleri).
// Kullanım: node scripts/gen-defaults.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, "docs/handy-radyoloji-prompt.txt"), "utf8").replace(/\r\n/g, "\n");

const NAMES = {
  sablon_karotis_bta: "Karotis BT anjiyo",
  sablon_pulmoner_bta: "Pulmoner BT anjiyo",
  sablon_torakoabdominal_bta: "Torako-abdominal BT anjiyo",
  sablon_temporal: "Temporal",
  sablon_orbita: "Orbita",
  sablon_sinus: "Sinüs",
  sablon_kranial: "Kranial",
  sablon_toraks: "Toraks",
  sablon_batin: "Batın",
};

function between(start, end) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`bulunamadı: ${start}`);
  const from = i + start.length;
  const j = end === null ? src.length : src.indexOf(end, from);
  if (j < 0) throw new Error(`bulunamadı: ${end}`);
  return src.slice(from, j).trim();
}

const intro = src.slice(0, src.indexOf("MOD SEÇİMİ")).trim();

const modeBlock = between("MOD SEÇİMİ\n", "ŞABLON MODU");
const modeLines = modeBlock.split("\n");
const modeIntro = modeLines.filter((l) => !/^\d+\./.test(l) && !l.startsWith("Hiçbiri")).join("\n");
const modeFallback = modeLines.find((l) => l.startsWith("Hiçbiri"));
const order = modeLines
  .filter((l) => /^\d+\./.test(l))
  .map((l) => {
    const [, kw, tag] = l.match(/^\d+\.\s*(.+?)\s*→\s*(\S+)$/);
    const keywords = [...kw.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return { tag, keywords };
  });

const templateRules = between("ŞABLON MODU\n", "KISALTMA SÖZLÜĞÜ");

const abbrHeaderLine = src.slice(src.indexOf("KISALTMA SÖZLÜĞÜ")).split("\n")[0];
const abbreviationsIntro = abbrHeaderLine.replace("KISALTMA SÖZLÜĞÜ", "").trim();
const abbrBody = between(abbrHeaderLine + "\n", "<sablon_toraks>");
const abbrByName = {};
let current = null;
for (const line of abbrBody.split("\n")) {
  const head = line.match(/^([^\s-·].*):$/);
  if (head) {
    current = head[1];
    abbrByName[current] = [];
  } else if (current) {
    abbrByName[current].push(line);
  }
}

const bodies = {};
for (const m of src.matchAll(/<(sablon_\w+)>\n([\s\S]*?)\n<\/\1>/g)) bodies[m[1]] = m[2];

const spellingBlock = between("YAZIM SÖZLÜĞÜ\n", "GENEL KURALLAR");
const spellingLines = spellingBlock.split("\n");
const spellingEmpty = spellingLines.find((l) => l.startsWith("(Liste"));
const spellingIntro = spellingLines.filter((l) => l !== spellingEmpty).join("\n");

const generalRules = between("GENEL KURALLAR (her iki mod)\n", "<transkript>");
const outputRule = between("ÇIKTI: ", null);

const templates = order.map(({ tag, keywords }) => {
  const name = NAMES[tag];
  if (!name || !bodies[tag]) throw new Error(`şablon eksik: ${tag}`);
  return { tag, name, keywords, body: bodies[tag], abbreviations: (abbrByName[name] ?? []).join("\n").trim() };
});

const unused = Object.keys(abbrByName).filter((n) => !templates.some((t) => t.name === n));
if (unused.length) throw new Error(`eşleşmeyen kısaltma başlığı: ${unused.join(", ")}`);

const out = {
  intro,
  modeIntro,
  modeFallback,
  templateRules,
  abbreviationsIntro,
  spellingIntro,
  spellingEmpty,
  generalRules,
  outputRule,
  templates,
  spelling: [],
};
writeFileSync(path.join(root, "src-tauri/defaults/prompt-defaults.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`${templates.length} şablon yazıldı`);
