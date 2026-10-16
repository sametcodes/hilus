import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { errorText } from "./api";
import { h } from "./dom";

type Notify = (message: string, kind: "info" | "error" | "success") => void;

let notify: Notify = () => {};
let hasSession: () => boolean = () => false;
let pending: Update | null = null;
let checking = false;

export function initUpdater(opts: { notify: Notify; hasSession: () => boolean }) {
  notify = opts.notify;
  hasSession = opts.hasSession;
}

/** GitHub Releases'taki latest.json'a bakar; yeni sürüm varsa üst çubukta bant gösterir. */
export async function checkForUpdates(manual: boolean) {
  if (checking) return;
  checking = true;
  try {
    const update = await check();
    if (update) {
      pending = update;
      showBanner(update);
      if (manual) notify(`Yeni sürüm var: ${update.version}`, "info");
    } else if (manual) {
      notify("Hilus güncel.", "success");
    }
  } catch (err) {
    if (manual) notify(`Güncelleme denetlenemedi: ${errorText(err)}`, "error");
  } finally {
    checking = false;
  }
}

function showBanner(update: Update) {
  const banner = document.getElementById("update-banner")!;
  banner.hidden = false;
  banner.replaceChildren(
    h("span", {}, `Yeni sürüm ${update.version}`),
    h("button", { class: "btn small primary", onclick: () => void install() }, "Güncelle"),
  );
}

async function install() {
  const update = pending;
  if (!update) return;
  if (hasSession() && !confirm("Güncelleme uygulamayı yeniden başlatır; açık dikte parçaları ve rapor silinir. Devam edilsin mi?")) {
    return;
  }
  const banner = document.getElementById("update-banner")!;
  const label = h("span", {}, "İndiriliyor…");
  banner.replaceChildren(label);
  let total = 0;
  let done = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") {
        done += event.data.chunkLength;
        label.textContent = total ? `İndiriliyor %${Math.floor((done / total) * 100)}` : "İndiriliyor…";
      }
      if (event.event === "Finished") label.textContent = "Kuruluyor…";
    });
    await relaunch();
  } catch (err) {
    notify(`Güncelleme kurulamadı: ${errorText(err)}`, "error");
    showBanner(update);
  }
}
