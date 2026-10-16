import { api, errorText } from "./api";
import { h } from "./dom";

type Notify = (message: string, kind: "info" | "error" | "success") => void;

/**
 * "Sorun bildir" penceresi. Açıklama + aşağıda listelenen teknik bilgi gönderilir;
 * Worker bunu GitHub'da herkese açık bir issue olarak açar. Dikte/rapor gönderilmez.
 */
export function openReportDialog(details: Record<string, string>, notify: Notify) {
  const textarea = h("textarea", {
    rows: 6,
    placeholder: "Ne oldu? Ne bekliyordunuz? (ör. “Kopyala'dan sonra rapor programında kalın görünmüyor”)",
  });
  const send = h("button", { class: "btn primary" }, "Gönder");
  const cancel = h("button", { class: "btn ghost" }, "Vazgeç");
  const error = h("p", { class: "hint warn", hidden: true });
  const info = h(
    "details",
    { class: "report-info" },
    h("summary", {}, "Eklenecek teknik bilgi"),
    h("ul", {}, ...Object.entries(details).map(([k, v]) => h("li", {}, h("span", { class: "muted" }, `${k}: `), v))),
  );
  const card = h(
    "div",
    { class: "dialog report-dialog", role: "dialog", "aria-modal": "true" },
    h("h2", {}, "Sorun bildir"),
    h("p", { class: "hint warn-box" }, "Bildirim herkese açık olarak yayımlanır. Hasta adı, protokol numarası veya rapor metni yazmayın."),
    textarea,
    info,
    error,
    h("div", { class: "dialog-actions" }, cancel, send),
  );
  const overlay = h("div", { class: "dialog-overlay" }, card);

  const close = () => {
    document.removeEventListener("keydown", keys, true);
    overlay.remove();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.code === "Space" && !(e.target instanceof HTMLTextAreaElement)) {
      // Pencere açıkken Space kayıt başlatmasın.
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const submit = async () => {
    const description = textarea.value.trim();
    if (description.length < 5) {
      error.textContent = "Lütfen sorunu kısaca anlatın.";
      error.hidden = false;
      return;
    }
    send.disabled = true;
    send.textContent = "Gönderiliyor…";
    try {
      const number = await api.sendReport(description, details);
      close();
      notify(`Bildirim gönderildi (#${number}). Teşekkürler!`, "success");
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
      send.disabled = false;
      send.textContent = "Gönder";
    }
  };

  cancel.addEventListener("click", close);
  send.addEventListener("click", () => void submit());
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  });
  document.addEventListener("keydown", keys, true);
  document.body.append(overlay);
  textarea.focus();
}
