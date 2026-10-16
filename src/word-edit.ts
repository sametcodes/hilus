import { h } from "./dom";
import type { Part } from "./types";

/**
 * Parça metninde kelime düzeyinde hızlı düzeltme:
 * - kelimeye tıkla → o kelime yerinde kutuda açılır;
 * - sürükle ya da Shift'e basılıyken tıkla → aralık seçilir; bırakınca (Shift'i bırakınca)
 *   seçilen kelimeler tek kutuda açılır. Enter / odak kaybı kaydeder, Esc vazgeçer.
 */

interface Range {
  id: number;
  a: number;
  b: number;
}

let selection: Range | null = null;
let anchor = -1;
let dragging = false;
let editing: (Range & { value: string }) | null = null;
/** Yeniden çizimde eski kutunun odak kaybı düzeltmeyi erken kaydetmesin. */
let editGen = 0;
let host: { rerender: () => void; find: (id: number) => Part | undefined; remove: (p: Part) => void };

export function initWordEdit(opts: typeof host) {
  host = opts;
  window.addEventListener("keyup", (e) => {
    if (e.key === "Shift" && selection && !dragging) openEditor();
  });
  window.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    if (!e.shiftKey) openEditor();
  });
  // Başka yere tıklanınca yarım kalan seçimi bırak.
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (selection && !e.shiftKey && !(e.target as HTMLElement).closest?.(".words")) {
        selection = null;
        paintSelection();
      }
    },
    true,
  );
}

export function isWordEditing(): boolean {
  return editing !== null;
}

function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

const isSpace = (t: string) => /^\s+$/.test(t);

/** Parça metnini tıklanabilir kelimeler (ya da açık düzeltme kutusu) olarak çizer. */
export function wordText(p: Part): HTMLElement {
  const tokens = tokenize(p.text);
  const el = h("div", { class: "part-text words", "data-part": String(p.id) });
  const edit = editing?.id === p.id ? editing : null;
  tokens.forEach((t, i) => {
    if (edit && i > edit.a && i <= edit.b) return;
    if (edit && i === edit.a) {
      el.append(editorInput(p, tokens, edit));
      return;
    }
    if (isSpace(t)) el.append(t);
    else el.append(h("span", { class: "word", "data-i": String(i) }, t));
  });
  el.addEventListener("pointerdown", (e) => onPointerDown(e, p));
  el.addEventListener("pointerover", (e) => {
    if (!dragging || selection?.id !== p.id) return;
    const i = wordIndex(e.target);
    if (i < 0) return;
    selection = { id: p.id, a: Math.min(anchor, i), b: Math.max(anchor, i) };
    paintSelection();
  });
  queueMicrotask(paintSelection);
  return el;
}

function wordIndex(target: EventTarget | null): number {
  const word = (target as HTMLElement | null)?.closest?.(".word");
  return word ? Number(word.getAttribute("data-i")) : -1;
}

function onPointerDown(e: PointerEvent, p: Part) {
  if (e.button !== 0) return;
  const i = wordIndex(e.target);
  if (i < 0) return;
  e.preventDefault();
  if (e.shiftKey && selection?.id === p.id) {
    selection = { id: p.id, a: Math.min(anchor, i), b: Math.max(anchor, i) };
  } else {
    anchor = i;
    selection = { id: p.id, a: i, b: i };
    dragging = !e.shiftKey;
  }
  paintSelection();
}

function paintSelection() {
  document.querySelectorAll(".word.sel").forEach((w) => w.classList.remove("sel"));
  if (!selection) return;
  const box = document.querySelector(`.words[data-part="${selection.id}"]`);
  box?.querySelectorAll<HTMLElement>(".word").forEach((w) => {
    const i = Number(w.dataset.i);
    w.classList.toggle("sel", i >= selection!.a && i <= selection!.b);
  });
}

function openEditor() {
  const sel = selection;
  selection = null;
  const p = sel && host.find(sel.id);
  if (!sel || !p) return paintSelection();
  editing = { ...sel, value: tokenize(p.text).slice(sel.a, sel.b + 1).join("") };
  host.rerender();
}

function editorInput(p: Part, tokens: string[], edit: Range & { value: string }): HTMLInputElement {
  const input = h("input", { type: "text", class: "word-editor", value: edit.value, spellcheck: false });
  const fit = () => (input.size = Math.max(3, input.value.length + 1));
  fit();
  const gen = ++editGen;
  let done = false;
  const finish = (save: boolean) => {
    if (done || gen !== editGen) return;
    done = true;
    editing = null;
    if (save) {
      const before = tokens.slice(0, edit.a).join("");
      const after = tokens.slice(edit.b + 1).join("");
      p.text = `${before}${input.value.trim()}${after}`.replace(/[ \t]{2,}/g, " ").trim();
      if (!p.text) return host.remove(p);
    }
    host.rerender();
  };
  input.addEventListener("input", () => {
    edit.value = input.value;
    fit();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  return input;
}
