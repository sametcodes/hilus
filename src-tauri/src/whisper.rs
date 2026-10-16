//! Yerel Whisper (transcribe.cpp) — model bulma, indirme, yükleme ve çözümleme.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use transcribe_cpp::{Model, RunOptions, Session, TimestampKind};

pub const MODEL_FILE: &str = "whisper-large-v3-turbo-Q8_0.gguf";
const HF_REPO_DIR: &str = "models--handy-computer--whisper-large-v3-turbo-gguf";
const MODEL_URL: &str = "https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/resolve/main/whisper-large-v3-turbo-Q8_0.gguf";

/// Sessizlikte Whisper'ın sık uydurduğu altyazı kalıpları.
const HALLUCINATIONS: &[&str] = &[
    "Altyazı M.K.",
    "Altyazı M.K",
    "İzlediğiniz için teşekkürler.",
    "Abone olmayı unutmayın.",
];

#[derive(Clone, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum ModelStatus {
    Checking,
    Missing,
    #[serde(rename_all = "camelCase")]
    Downloading { downloaded: u64, total: u64 },
    #[serde(rename_all = "camelCase")]
    Loading { path: String },
    #[serde(rename_all = "camelCase")]
    Ready { path: String, backend: String },
    #[serde(rename_all = "camelCase")]
    Error { message: String },
}

pub struct Engine {
    session: Mutex<Option<Session>>,
    status: Mutex<ModelStatus>,
    downloading: AtomicBool,
}

impl Default for Engine {
    fn default() -> Self {
        Engine {
            session: Mutex::new(None),
            status: Mutex::new(ModelStatus::Checking),
            downloading: AtomicBool::new(false),
        }
    }
}

impl Engine {
    pub fn status(&self) -> ModelStatus {
        self.status.lock().map(|s| s.clone()).unwrap_or(ModelStatus::Checking)
    }

    fn set_status(&self, app: &AppHandle, status: ModelStatus) {
        if let Ok(mut s) = self.status.lock() {
            *s = status.clone();
        }
        let _ = app.emit("model-status", status);
    }

    pub fn transcribe(&self, pcm: &[f32], initial_prompt: &str) -> Result<String, String> {
        let peak = pcm.iter().fold(0f32, |m, s| m.max(s.abs()));
        if pcm.len() < 4_000 || peak < 0.003 {
            return Ok(String::new());
        }
        // Çok kısa kayıtları 1 sn'ye tamamla.
        let mut padded;
        let audio = if pcm.len() < 16_000 {
            padded = pcm.to_vec();
            padded.resize(16_000, 0.0);
            &padded[..]
        } else {
            pcm
        };
        let prompt = initial_prompt.trim();
        let options = RunOptions {
            language: Some("tr".into()),
            timestamps: TimestampKind::None,
            prompt: (!prompt.is_empty()).then(|| prompt.to_string()),
            ..Default::default()
        };
        let mut guard = self.session.lock().map_err(|e| e.to_string())?;
        let session = guard
            .as_mut()
            .ok_or_else(|| "Whisper modeli henüz hazır değil.".to_string())?;
        let result = session
            .run(audio, &options)
            .map_err(|e| format!("Çözümleme hatası: {e}"))?;
        Ok(clean_transcript(&result.text))
    }
}

fn clean_transcript(text: &str) -> String {
    let mut t = text.trim().to_string();
    for h in HALLUCINATIONS {
        t = t.replace(h, "");
    }
    t.trim().to_string()
}

/// Handy'nin Hugging Face önbelleğindeki modeli, sonra uygulamanın kendi
/// indirdiği kopyayı arar.
pub fn find_model(app: &AppHandle) -> Option<PathBuf> {
    hf_cache_roots()
        .into_iter()
        .find_map(|root| find_in_hf_cache(&root))
        .or_else(|| own_model_path(app).filter(|p| p.is_file()))
}

fn hf_cache_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(p) = std::env::var("HF_HUB_CACHE") {
        roots.push(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("HF_HOME") {
        roots.push(PathBuf::from(p).join("hub"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".cache").join("huggingface").join("hub"));
    }
    roots
}

fn find_in_hf_cache(root: &Path) -> Option<PathBuf> {
    let snapshots = root.join(HF_REPO_DIR).join("snapshots");
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(snapshots)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path().join(MODEL_FILE))
        .filter(|p| p.is_file())
        .collect();
    // En son değişen anlık görüntüyü tercih et.
    candidates.sort_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok());
    candidates.pop()
}

fn own_model_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("models").join(MODEL_FILE))
}

/// Modeli bulur ve arka planda yükler. Bulunamazsa durum `Missing` olur.
pub fn init(app: AppHandle) {
    // Yerel kütüphane günlükleri kapalı: konsola içerik sızmasın, gürültü olmasın.
    transcribe_cpp::disable_logging();
    std::thread::spawn(move || {
        let engine = app.state::<Engine>();
        match find_model(&app) {
            Some(path) => load(&app, &engine, &path),
            None => engine.set_status(&app, ModelStatus::Missing),
        }
    });
}

fn load(app: &AppHandle, engine: &Engine, path: &Path) {
    let shown = path.display().to_string();
    engine.set_status(app, ModelStatus::Loading { path: shown.clone() });
    let loaded = Model::load(path).and_then(|m| {
        let backend = m.backend();
        m.session().map(|s| (s, backend))
    });
    match loaded {
        Ok((session, backend)) => {
            if let Ok(mut g) = engine.session.lock() {
                *g = Some(session);
            }
            engine.set_status(app, ModelStatus::Ready { path: shown, backend });
        }
        Err(e) => engine.set_status(
            app,
            ModelStatus::Error {
                message: format!("Model yüklenemedi ({shown}): {e}"),
            },
        ),
    }
}

/// Modeli Hugging Face'ten uygulama veri klasörüne indirir, sonra yükler.
pub async fn download(app: AppHandle) -> Result<(), String> {
    let engine = app.state::<Engine>();
    if engine.downloading.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = download_inner(&app, &engine).await;
    engine.downloading.store(false, Ordering::SeqCst);
    match result {
        Ok(path) => {
            let app2 = app.clone();
            std::thread::spawn(move || load(&app2, &app2.state::<Engine>(), &path));
            Ok(())
        }
        Err(e) => {
            engine.set_status(&app, ModelStatus::Error { message: e.clone() });
            Err(e)
        }
    }
}

async fn download_inner(app: &AppHandle, engine: &Engine) -> Result<PathBuf, String> {
    let target = own_model_path(app).ok_or("Uygulama veri klasörü bulunamadı.")?;
    let dir = target.parent().ok_or("Geçersiz model yolu.")?;
    tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    let part = target.with_extension("gguf.part");

    let response = reqwest::get(MODEL_URL)
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("İndirme başlatılamadı: {e}"))?;
    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;
    engine.set_status(app, ModelStatus::Downloading { downloaded, total });
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("İndirme kesildi: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emit > 4 * 1024 * 1024 {
            last_emit = downloaded;
            engine.set_status(app, ModelStatus::Downloading { downloaded, total });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if total > 0 && downloaded != total {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(format!("İndirme eksik kaldı ({downloaded}/{total} bayt)."));
    }
    tokio::fs::rename(&part, &target).await.map_err(|e| e.to_string())?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gerçek modelle uçtan uca çözümleme. Çalıştırma:
    /// HILUS_TEST_WAV=dikte.wav cargo test --release -- --ignored whisper_smoke --nocapture
    #[test]
    #[ignore]
    fn whisper_smoke() {
        let wav = std::env::var("HILUS_TEST_WAV").expect("HILUS_TEST_WAV");
        let mut reader = hound::WavReader::open(wav).unwrap();
        let spec = reader.spec();
        assert_eq!((spec.sample_rate, spec.channels), (16_000, 1));
        let pcm: Vec<f32> = reader
            .samples::<i16>()
            .map(|s| s.unwrap() as f32 / 32768.0)
            .collect();
        let path = hf_cache_roots()
            .into_iter()
            .find_map(|r| find_in_hf_cache(&r))
            .expect("Handy modeli bulunamadı");
        let model = Model::load(&path).unwrap();
        println!("model: {} · {}", path.display(), model.backend());
        let engine = Engine::default();
        *engine.session.lock().unwrap() = Some(model.session().unwrap());
        let t0 = std::time::Instant::now();
        let plain = engine.transcribe(&pcm, "").unwrap();
        println!("bağlamsız ({:?}): {plain}", t0.elapsed());
        let t0 = std::time::Instant::now();
        let prompted = engine
            .transcribe(&pcm, &crate::settings::Settings::default().whisper_prompt)
            .unwrap();
        println!("bağlamlı ({:?}): {prompted}", t0.elapsed());
        assert!(!plain.is_empty());
    }
}
