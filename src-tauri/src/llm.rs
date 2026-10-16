//! LLM çağrısı: Anthropic Messages API veya OpenAI-uyumlu sohbet ucu (Gemini dahil).

use std::time::Duration;

use serde_json::{json, Value};

use crate::settings::Settings;

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai";
const MAX_TOKENS: u32 = 16_000;

pub async fn complete(settings: &Settings, prompt: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    match settings.provider.as_str() {
        "gemini" => {
            openai_compatible(
                &client,
                GEMINI_BASE_URL,
                &settings.gemini_key,
                &settings.gemini_model,
                prompt,
            )
            .await
        }
        "openai" => {
            openai_compatible(
                &client,
                &settings.openai_base_url,
                &settings.openai_key,
                &settings.openai_model,
                prompt,
            )
            .await
        }
        _ => anthropic(&client, settings, prompt).await,
    }
}

async fn anthropic(
    client: &reqwest::Client,
    settings: &Settings,
    prompt: &str,
) -> Result<String, String> {
    require(&settings.anthropic_key, "Anthropic API anahtarı")?;
    require(&settings.anthropic_model, "Anthropic modeli")?;
    let model = settings.anthropic_model.trim();
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "messages": [{ "role": "user", "content": prompt }],
    });
    let mut request = client
        .post(ANTHROPIC_URL)
        .header("x-api-key", settings.anthropic_key.trim())
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
