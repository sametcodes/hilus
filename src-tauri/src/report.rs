//! "Sorun bildir": kısa açıklama + teknik bilgiyi Worker'a gönderir, Worker GitHub issue'su açar.
//! Dikte, rapor veya ses gönderilmez.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tauri::AppHandle;

const REPORT_URL: &str = "https://hilus-report.hey-d80.workers.dev/report";

#[derive(Deserialize)]
struct ReportResponse {
    number: Option<u64>,
    error: Option<String>,
}

pub async fn send(
    app: &AppHandle,
    description: &str,
    details: BTreeMap<String, String>,
) -> Result<u64, String> {
    let body = json!({
        "description": description,
        "version": app.package_info().version.to_string(),
        "os": format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        "details": details,
    });
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .post(REPORT_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Bildirim gönderilemedi: {e}"))?;
    let parsed: ReportResponse = response
        .json()
        .await
        .map_err(|e| format!("Yanıt okunamadı: {e}"))?;
    match (parsed.number, parsed.error) {
        (Some(n), _) => Ok(n),
        (None, Some(e)) => Err(e),
        _ => Err("Bilinmeyen yanıt.".into()),
    }
}
