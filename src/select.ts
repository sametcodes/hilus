import { h } from "./dom";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Liste uzunsa üstte arama kutusu göster. */
  searchable?: boolean;
  /** Serbest metin girilebilen birleşik kutu (ör. model adı). */
  editable?: boolean;
  emptyText?: string;
  className?: string;
}

let openPopover: { close: () => void } | null = null;

/** Native <select> yerine kullanılan açılır liste. */
export function customSelect(props: SelectProps): HTMLElement {
  const root = h("div", { class: `cs${props.editable ? " cs-editable" : ""} ${props.className ?? ""}` });
  let value = props.value;
  const labelOf = (v: string) => props.options.find((o) => o.value === v)?.label ?? v;

  const trigger = props.editable
    ? h("input", { type: "text", class: "cs-input", value, placeholder: props.placeholder ?? "", spellcheck: false })
    : h("button", { type: "button", class: "cs-trigger" }, h("span", { class: "cs-label" }, value ? labelOf(value) : props.placeholder ?? "Seçin"));
  const chevron = h("button", { type: "button", class: "cs-chevron", tabindex: -1, "aria-label": "Listeyi aç" });
  root.append(trigger, chevron);

  const commit = (v: string) => {
    value = v;
    if (trigger instanceof HTMLInputElement) trigger.value = v;
    else trigger.querySelector(".cs-label")!.textContent = labelOf(v);
    props.onChange(v);
  };

  const open = (filter = "") => {
    openPopover?.close();
    const popover = h("div", { class: "cs-popover", role: "listbox" });
    const search = props.searchable && !props.editable ? h("input", { type: "text", class: "cs-search", placeholder: "Ara…", spellcheck: false }) : null;
    const list = h("div", { class: "cs-list" });
    if (search) popover.append(search);
    popover.append(list);
    document.body.append(popover);
    let active = -1;
    let shown: SelectOption[] = [];

    const draw = (q: string) => {
      const needle = q.trim().toLocaleLowerCase("tr");
      shown = needle
        ? props.options.filter((o) => `${o.label} ${o.value}`.toLocaleLowerCase("tr").includes(needle))
        : props.options;
      active = Math.max(0, shown.findIndex((o) => o.value === value));
      list.replaceChildren(
        ...(shown.length
          ? shown.map((o, i) =>
              h(
                "div",
                {
                  class: `cs-option${o.value === value ? " selected" : ""}${i === active ? " active" : ""}`,
                  role: "option",
                  onpointerdown: (e: Event) => e.preventDefault(),
                  onclick: () => choose(o.value),
                },
                h("span", {}, o.label),
                o.hint ? h("span", { class: "cs-hint" }, o.hint) : null,
              ),
            )
          : [h("div", { class: "cs-empty" }, props.emptyText ?? "Sonuç yok")]),
      );
      place();
    };
    const highlight = (i: number) => {
      if (!shown.length) return;
      active = (i + shown.length) % shown.length;
      list.querySelectorAll(".cs-option").forEach((el, j) => el.classList.toggle("active", j === active));
      list.children[active]?.scrollIntoView({ block: "nearest" });
    };
    const place = () => {
      const r = root.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const height = Math.min(popover.scrollHeight, 300);
      const up = below < height && r.top > below;
      popover.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 220) - 8))}px`;
      popover.style.width = `${Math.max(r.width, 220)}px`;
      popover.style.top = up ? `${Math.max(8, r.top - height - 4)}px` : `${r.bottom + 4}px`;
    };
    const close = () => {
      popover.remove();
      root.classList.remove("open");
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keys, true);
      window.removeEventListener("resize", close);
      if (openPopover?.close === close) openPopover = null;
    };
    const choose = (v: string) => {
      commit(v);
      close();
      // Odak düğmede kalırsa sonraki Space kayıt yerine listeyi açar.
      (trigger as HTMLElement).blur();
    };
    const outside = (e: Event) => {
      if (!popover.contains(e.target as Node) && !root.contains(e.target as Node)) close();
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") highlight(active + 1);
      else if (e.key === "ArrowUp") highlight(active - 1);
      else if (e.key === "Enter" && shown[active]) choose(shown[active].value);
      else if (e.key === "Escape" || e.key === "Tab") close();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    window.addEventListener("resize", close);
    root.classList.add("open");
    openPopover = { close };
    search?.addEventListener("input", () => draw(search.value));
    if (trigger instanceof HTMLInputElement) {
      trigger.oninput = () => {
        commit(trigger.value);
        draw(trigger.value);
      };
    }
    draw(filter);
    search?.focus();
  };

  const toggle = () => (root.classList.contains("open") ? openPopover?.close() : open());
  chevron.addEventListener("click", () => {
    toggle();
    if (props.editable) trigger.focus();
  });
  if (trigger instanceof HTMLInputElement) {
    trigger.addEventListener("focus", () => {
      if (!root.classList.contains("open") && props.options.length) open();
    });
    trigger.addEventListener("input", () => {
      if (!root.classList.contains("open")) open(trigger.value);
    });
    trigger.addEventListener("blur", () => setTimeout(() => openPopover?.close(), 120));
  } else {
    trigger.addEventListener("click", toggle);
    trigger.addEventListener("keydown", (e) => {
      if ((e.key === "ArrowDown" || e.key === "Enter") && !root.classList.contains("open")) {
        e.preventDefault();
        open();
      }
    });
  }
  return root;
}
