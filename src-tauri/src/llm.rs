//! LLM çağrısı: Anthropic Messages API veya OpenAI-uyumlu sohbet ucu (Gemini dahil).

use std::time::Duration;

use serde_json::{json, Value};

use crate::settings::{ModelChoice, Settings};

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai";
const MAX_TOKENS: u32 = 16_000;

/// Başarılı rapor yanıtı: metin, onu yazan model ve önceki denemelerin hataları.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub text: String,
    pub provider: String,
    pub model: String,
    pub failures: Vec<String>,
}

/// Zincirdeki modelleri sırayla dener; ilk başarılı yanıtı döndürür. Hangi hata
/// olursa olsun (kota, bağlantı, anahtar, sunucu) sıradaki modele geçilir.
pub async fn complete(settings: &Settings, prompt: &str) -> Result<Completion, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut failures = Vec::new();
    for (i, choice) in settings.chain().into_iter().enumerate() {
        match complete_one(&client, &choice, prompt).await {
            Ok(text) => {
                return Ok(Completion {
                    text,
                    provider: choice.provider,
                    model: choice.model,
                    failures,
                })
            }
            Err(e) => failures.push(format!("{}. {}: {e}", i + 1, choice_label(&choice))),
        }
    }
    Err(match failures.as_slice() {
        [only] => only.clone(),
        all => format!("Sıradaki modellerin hiçbiri yanıt veremedi:\n{}", all.join("\n")),
    })
}

fn choice_label(choice: &ModelChoice) -> String {
    let provider = match choice.provider.as_str() {
        "gemini" => "Gemini",
        "openai" => "OpenAI-uyumlu",
        _ => "Anthropic",
    };
    format!("{provider} · {}", choice.model.trim())
}

async fn complete_one(
    client: &reqwest::Client,
    choice: &ModelChoice,
    prompt: &str,
) -> Result<String, String> {
    match choice.provider.as_str() {
        "gemini" => openai_compatible(client, GEMINI_BASE_URL, &choice.api_key, &choice.model, prompt).await,
        "openai" => openai_compatible(client, &choice.base_url, &choice.api_key, &choice.model, prompt).await,
        _ => anthropic(client, &choice.api_key, &choice.model, prompt).await,
    }
}

async fn anthropic(
    client: &reqwest::Client,
    key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    require(key, "Anthropic API anahtarı")?;
    require(model, "Anthropic modeli")?;
    let model = model.trim();
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "messages": [{ "role": "user", "content": prompt }],
    });
    let mut request = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", key.trim())
        .header("anthropic-version", "2023-06-01");
    // Sonnet 5.5 güvenlik sınıflandırıcısı reddederse sunucu tarafı yedek modele düşsün.
    if model == "claude-sonnet-5-5" {
        body["fallbacks"] = json!("default");
        request = request.header("anthropic-beta", "server-side-fallback-2026-07-01");
    }
    let value = send(request.json(&body)).await?;
    if value["stop_reason"] == "refusal" {
        return Err("Model isteği reddetti (refusal).".into());
    }
    let text: String = value["content"]
        .as_array()
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b["type"] == "text")
                .filter_map(|b| b["text"].as_str())
                .collect()
        })
        .unwrap_or_default();
    if value["stop_reason"] == "max_tokens" {
        return Err("Yanıt uzunluk sınırında kesildi.".into());
    }
    non_empty(text)
}

async fn openai_compatible(
    client: &reqwest::Client,
    base_url: &str,
    key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    require(base_url, "Sağlayıcı adresi")?;
    require(key, "API anahtarı")?;
    require(model, "Model adı")?;
    let url = format!("{}/chat/completions", base_url.trim().trim_end_matches('/'));
    let body = json!({
        "model": model.trim(),
        "messages": [{ "role": "user", "content": prompt }],
    });
    let value = send(client.post(url).bearer_auth(key.trim()).json(&body)).await?;
    let text = value["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string();
    non_empty(text)
}

async fn send(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let response = request
        .send()
        .await
        .map_err(|e| format!("Bağlantı hatası: {e}"))?;
    let status = response.status();
    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("Yanıt okunamadı ({status}): {e}"))?;
    if !status.is_success() {
        return Err(format!("{}: {}", status, error_message(&value)));
    }
    Ok(value)
}

fn error_message(value: &Value) -> String {
    let err = &value["error"];
    err["message"]
        .as_str()
        .or_else(|| err.as_str())
        .or_else(|| value[0]["error"]["message"].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn require(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} ayarlarda boş."));
    }
    Ok(())
}

fn non_empty(text: String) -> Result<String, String> {
    let t = text.trim().to_string();
    if t.is_empty() {
        return Err("Model boş yanıt döndürdü.".into());
    }
    Ok(t)
}

#[derive(serde::Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

/// Sağlayıcının model listesini API anahtarıyla çeker.
pub async fn list_models(
    provider: &str,
    api_key: &str,
    base_url: &str,
) -> Result<Vec<ModelInfo>, String> {
    require(api_key, "API anahtarı")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    match provider {
        "anthropic" => {
            let request = client
                .get("https://api.anthropic.com/v1/models?limit=1000")
                .header("x-api-key", api_key.trim())
                .header("anthropic-version", "2023-06-01");
            let value = send(request).await?;
            Ok(parse_models(&value, "display_name", |_| true))
        }
        "gemini" => {
            let request = client
                .get(format!("{GEMINI_BASE_URL}/models"))
                .bearer_auth(api_key.trim());
            let value = send(request).await?;
            // Yalnızca sohbet modelleri; gömme, görsel, ses vb. dışarıda.
            Ok(parse_models(&value, "display_name", |id| {
                id.starts_with("gemini")
                    && !["embedding", "image", "tts", "audio", "live", "aqa"]
                        .iter()
                        .any(|x| id.contains(x))
            }))
        }
        _ => {
            require(base_url, "Sağlayıcı adresi")?;
            let url = format!("{}/models", base_url.trim().trim_end_matches('/'));
            let value = send(client.get(url).bearer_auth(api_key.trim())).await?;
            Ok(parse_models(&value, "", |_| true))
        }
    }
}

fn parse_models(value: &Value, label_key: &str, keep: impl Fn(&str) -> bool) -> Vec<ModelInfo> {
    let items = value["data"]
        .as_array()
        .or_else(|| value["models"].as_array())
        .cloned()
        .unwrap_or_default();
    let mut models: Vec<ModelInfo> = items
        .iter()
        .filter_map(|m| {
            let raw = m["id"].as_str().or_else(|| m["name"].as_str())?;
            let id = raw.trim_start_matches("models/").to_string();
            let label = m[label_key].as_str().unwrap_or(&id).to_string();
            keep(&id).then_some(ModelInfo { id, label })
        })
        .collect();
    // Anthropic yeniden eskiye sıralı gelir; diğerlerinde ada göre sırala.
    if label_key.is_empty() || value["data"][0]["display_name"].is_null() {
        models.sort_by(|a, b| a.id.cmp(&b.id));
    }
    models.dedup_by(|a, b| a.id == b.id);
    models
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// Tek isteğe sabit bir sohbet yanıtı veren yerel sahte sunucu; adresini döndürür.
    fn fake_server(status: &'static str, body: &'static str) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 65536];
            let _ = stream.read(&mut buf);
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        format!("http://{addr}/v1")
    }

    fn settings_with(chain: &[(&str, &str)], openai_base_url: String) -> Settings {
        Settings {
            model_chain: chain
                .iter()
                .map(|(p, m)| ModelChoice {
                    provider: p.to_string(),
                    model: m.to_string(),
                    api_key: if *p == "openai" { "test".into() } else { String::new() },
                    base_url: openai_base_url.clone(),
                })
                .collect(),
            ..Settings::default()
        }
    }

    #[test]
    fn hata_verince_siradaki_modele_gecer() {
        let base = fake_server("200 OK", r#"{"choices":[{"message":{"content":"RAPOR"}}]}"#);
        // Gemini anahtarı boş: ilk model hata verir, ikinci (sahte sunucu) yazar.
        let settings = settings_with(&[("gemini", "gemini-2.5-flash"), ("openai", "yedek-model")], base);
        let result = tauri::async_runtime::block_on(complete(&settings, "x")).unwrap();
        assert_eq!(result.text, "RAPOR");
        assert_eq!(result.model, "yedek-model");
        assert_eq!(result.failures.len(), 1);
        assert!(result.failures[0].starts_with("1. Gemini · gemini-2.5-flash:"));
    }

    #[test]
    fn hepsi_basarisizsa_tum_hatalar_listelenir() {
        let base = fake_server("429 Too Many Requests", r#"{"error":{"message":"quota"}}"#);
        let settings = settings_with(&[("openai", "a"), ("gemini", "b")], base);
        let err = tauri::async_runtime::block_on(complete(&settings, "x")).unwrap_err();
        assert!(err.contains("1. OpenAI-uyumlu · a: 429"), "{err}");
        assert!(err.contains("2. Gemini · b:"), "{err}");
    }
}
