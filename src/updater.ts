import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { errorText } from "./api";
import { h } from "./dom";
import { confirmDialog } from "./dialog";

type Notify = (message: string, kind: "info" | "error" | "success") => void;

/** Uygulama tepside gün boyu açık kalabildiği için açılıştan sonra da arada bir denetlenir. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

let notify: Notify = () => {};
let hasSession: () => boolean = () => false;
let ready: Update | null = null;
let busy = false;

export function initUpdater(opts: { notify: Notify; hasSession: () => boolean }) {
  notify = opts.notify;
  hasSession = opts.hasSession;
}

/** Açılışta ve sonra RECHECK_MS aralıklarla sessizce denetler; yeni sürümü kendiliğinden indirir. */
export function startAutoUpdates() {
  void checkForUpdates(false);
  window.setInterval(() => void checkForUpdates(false), RECHECK_MS);
}

/**
 * GitHub Releases'taki latest.json'a bakar; yeni sürüm varsa arka planda indirir ve
 * üst çubukta "Yeniden başlat" bandı gösterir. Kurulum yalnızca kullanıcı isteyince yapılır:
 * Windows'ta kurulum uygulamayı hemen kapatır, dikte ortasında olmamalı.
 */
export async function checkForUpdates(manual: boolean) {
  if (ready) {
    if (manual) notify(`Sürüm ${ready.version} indirildi; yeniden başlatınca kurulur.`, "info");
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const update = await check();
    if (!update) {
      if (manual) notify("Hilus güncel.", "success");
      return;
    }
    if (manual) notify(`Yeni sürüm var: ${update.version}; indiriliyor.`, "info");
    await download(update);
  } catch (err) {
    if (manual) notify(`Güncelleme indirilemedi: ${errorText(err)}`, "error");
    hideBanner();
  } finally {
    busy = false;
  }
}

async function download(update: Update) {
  const label = h("span", {}, `Sürüm ${update.version} indiriliyor…`);
  showBanner(label);
  let total = 0;
  let done = 0;
  await update.download((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    if (event.event !== "Progress") return;
    done += event.data.chunkLength;
    if (total) label.textContent = `Sürüm ${update.version} indiriliyor %${Math.floor((done / total) * 100)}`;
  });
  ready = update;
  showBanner(
    h("span", {}, `Sürüm ${update.version} hazır`),
    h("button", { class: "btn small primary", onclick: () => void install() }, "Yeniden başlat"),
  );
}

async function install() {
  const update = ready;
  if (!update) return;
  const message = "Yeniden başlatınca güncelleme kurulur; açık dikte parçaları ve rapor silinir. Devam edilsin mi?";
  if (hasSession() && !(await confirmDialog(message, { confirmLabel: "Yeniden başlat" }))) return;
  showBanner(h("span", {}, "Kuruluyor…"));
  try {
    await update.install();
    await relaunch();
  } catch (err) {
    notify(`Güncelleme kurulamadı: ${errorText(err)}`, "error");
    ready = null;
    hideBanner();
  }
}

function showBanner(...children: Node[]) {
  const banner = document.getElementById("update-banner")!;
  banner.hidden = false;
  banner.replaceChildren(...children);
}

function hideBanner() {
  document.getElementById("update-banner")!.hidden = true;
}
