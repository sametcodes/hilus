/** Kayıt başlangıcı/bitişi için kısa, kısık uyarı sesleri (WebAudio; ses dosyası yok). */

let ctx: AudioContext | null = null;

function tone(from: number, to: number, ms: number) {
  ctx ??= new AudioContext();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, now);
  osc.frequency.exponentialRampToValueAtTime(to, now + ms / 1000);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + ms / 1000 + 0.02);
}

export function playStart() {
  tone(660, 990, 90);
}

export function playStop() {
  tone(880, 520, 110);
}
