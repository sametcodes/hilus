// Hilus "Sorun bildir": uygulamadan gelen kısa bildirimi GitHub'da issue olarak açar.
// Doktorun GitHub hesabı gerekmez; token yalnızca bu Worker'ın gizlisinde durur.
// İstek gövdesi hiçbir yere kaydedilmez veya loglanmaz.

interface Env {
  GITHUB_TOKEN?: string;
  GITHUB_REPO: string;
  REPORT_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

interface Report {
  description: string;
  version: string;
  os: string;
  details: Record<string, string>;
}

const LABEL = "sorun-bildirimi";
const MAX_DESCRIPTION = 4000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/report") return json({ error: "Bulunamadı." }, 404);
    if (request.method !== "POST") return json({ error: "Yalnızca POST." }, 405);
    if (!env.GITHUB_TOKEN) return json({ error: "Bildirim servisi henüz yapılandırılmadı." }, 503);

    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.REPORT_LIMITER.limit({ key: ip });
    if (!success) return json({ error: "Çok sık bildirim gönderildi; bir dakika sonra yeniden deneyin." }, 429);

    const report = parseReport(await request.text());
    if (typeof report === "string") return json({ error: report }, 400);

    const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "hilus-report-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: issueTitle(report), body: issueBody(report), labels: [LABEL] }),
    });
    if (!response.ok) return json({ error: `GitHub isteği başarısız (${response.status}).` }, 502);
    const issue = (await response.json()) as { number: number; html_url: string };
    return json({ number: issue.number, url: issue.html_url }, 201);
  },
};

function parseReport(raw: string): Report | string {
  if (raw.length > 16_000) return "Bildirim çok uzun.";
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return "Geçersiz istek.";
  }
  const d = data as Partial<Report>;
  const description = typeof d.description === "string" ? d.description.trim() : "";
  if (description.length < 5) return "Lütfen sorunu kısaca anlatın.";
  if (description.length > MAX_DESCRIPTION) return "Açıklama çok uzun.";
  const details: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.details ?? {}).slice(0, 20)) {
    if (typeof v === "string") details[k.slice(0, 40)] = v.slice(0, 200);
  }
  return {
    description,
    version: String(d.version ?? "?").slice(0, 20),
    os: String(d.os ?? "?").slice(0, 60),
    details,
  };
}

/** Açıklamadaki @kullanıcı adları kimseyi etiketlemesin. */
function defuse(text: string): string {
  return text.replace(/@/g, "@​");
}

function oneLine(text: string): string {
  return text.replace(/[\r\n|]+/g, " ").trim();
}

function issueTitle(r: Report): string {
  const first = oneLine(r.description).slice(0, 72);
  return `Sorun bildirimi: ${first}${r.description.length > 72 ? "…" : ""}`;
}

function issueBody(r: Report): string {
  const rows = [
    ["Sürüm", r.version],
    ["İşletim sistemi", r.os],
    ...Object.entries(r.details),
  ]
    .map(([k, v]) => `| ${oneLine(k)} | ${oneLine(v)} |`)
    .join("\n");
  const quoted = defuse(r.description)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `${quoted}\n\n| Alan | Değer |\n|---|---|\n${rows}\n\n_Hilus içinden “Sorun bildir” ile gönderildi._`;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
