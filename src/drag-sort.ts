/**
 * İşaretçi (pointer) olaylarıyla sürükle-bırak sıralama. HTML5 drag & drop yerine bu yol
 * seçildi: Windows WebView2'de Tauri'nin dosya bırakma işleyicisiyle çakışmaz.
 * Küçük hareketler tıklama sayılır; 4 pikseli aşan hareket sürüklemeyi başlatır.
 * `handleSelector` verilirse sürükleme yalnızca o tutamaçtan başlar (satırda alan varsa).
 */
export function enableDragSort(
  container: HTMLElement,
  itemSelector: string,
  onMove: (from: number, to: number) => void,
  handleSelector?: string,
) {
  container.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    if (handleSelector && !(down.target as HTMLElement).closest(handleSelector)) return;
    const item = (down.target as HTMLElement).closest<HTMLElement>(itemSelector);
    if (!item || !container.contains(item)) return;
    const items = () => Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    const from = items().indexOf(item);
    const startY = down.clientY;
    let dragging = false;

    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(e.clientY - startY) < 4) return;
        dragging = true;
        item.setPointerCapture(down.pointerId);
        item.classList.add("dragging");
        container.classList.add("sorting");
      }
      const others = items().filter((el) => el !== item);
      const before = others.find((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      if (before) container.insertBefore(item, before);
      else others[others.length - 1]?.after(item);
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) return;
      item.classList.remove("dragging");
      container.classList.remove("sorting");
      // Sürüklemenin sonundaki tıklama, öğeyi seçmesin.
      const swallow = (c: Event) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      const to = items().indexOf(item);
      if (to !== from) onMove(from, to);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}
