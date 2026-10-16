import { h } from "./dom";

interface DialogOptions {
  confirmLabel?: string;
  cancelLabel?: string | null;
  danger?: boolean;
}

/**
 * Uygulama içi onay penceresi. Tauri'nin macOS web görünümü window.confirm/alert'i
 * göstermediği (hep "hayır" döndüğü) için bunun yerine kullanılır.
 */
export function confirmDialog(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const finish = (ok: boolean) => {
      document.removeEventListener("keydown", keys, true);
      overlay.remove();
      previous?.focus?.();
      resolve(ok);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
      else if (e.key === "Enter") finish(true);
      else if (e.code !== "Space") return; // pencere açıkken Space kayıt başlatmasın
      e.preventDefault();
      e.stopPropagation();
    };
    const okBtn = h(
      "button",
      { class: `btn ${opts.danger ? "danger-fill" : "primary"}`, onclick: () => finish(true) },
      opts.confirmLabel ?? "Tamam",
    );
    const cancel = opts.cancelLabel === null ? null : h("button", { class: "btn ghost", onclick: () => finish(false) }, opts.cancelLabel ?? "Vazgeç");
    const overlay = h(
      "div",
      { class: "dialog-overlay", onpointerdown: (e: Event) => e.target === overlay && finish(false) },
      h("div", { class: "dialog", role: "alertdialog", "aria-modal": "true" }, h("p", {}, message), h("div", { class: "dialog-actions" }, cancel, okBtn)),
    );
    document.body.append(overlay);
    document.addEventListener("keydown", keys, true);
    okBtn.focus();
  });
}

export function alertDialog(message: string): Promise<void> {
  return confirmDialog(message, { cancelLabel: null }).then(() => undefined);
}
