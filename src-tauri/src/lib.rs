mod audio;
mod clipboard;
mod llm;
mod rich;
mod settings;
mod tray;
mod whisper;

use std::sync::mpsc;

use tauri::{AppHandle, Manager, State};

use audio::Recorder;
use settings::{PromptConfig, Settings, SettingsStore};
use whisper::{Engine, ModelStatus};

#[tauri::command]
fn get_settings(store: State<SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
fn save_settings(store: State<SettingsStore>, settings: Settings) -> Result<(), String> {
    store.save(settings)
}

#[tauri::command]
fn default_prompt_config() -> PromptConfig {
    PromptConfig::default()
}

#[tauri::command]
fn list_microphones() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
fn model_status(engine: State<Engine>) -> ModelStatus {
    engine.status()
}

#[tauri::command]
async fn download_model(app: AppHandle) -> Result<(), String> {
    whisper::download(app).await
}

#[tauri::command]
fn start_recording(
    app: AppHandle,
    recorder: State<Recorder>,
    store: State<SettingsStore>,
) -> Result<(), String> {
    recorder.start(app, store.get().microphone)
}

/// Kaydı durdurur ve sesi yerelde çözümler. Ses yalnızca bu çağrı boyunca bellekte yaşar.
#[tauri::command]
async fn stop_and_transcribe(app: AppHandle) -> Result<String, String> {
    let pcm = app.state::<Recorder>().stop()?;
    let prompt = app.state::<SettingsStore>().get().whisper_prompt;
    tauri::async_runtime::spawn_blocking(move || app.state::<Engine>().transcribe(&pcm, &prompt))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn process_report(app: AppHandle, prompt: String) -> Result<String, String> {
    let settings = app.state::<SettingsStore>().get();
    llm::complete(&settings, &prompt).await
}

#[tauri::command]
async fn list_models(
    provider: String,
    api_key: String,
    base_url: String,
) -> Result<Vec<llm::ModelInfo>, String> {
    llm::list_models(&provider, &api_key, &base_url).await
}

#[tauri::command]
async fn copy_report(app: AppHandle, text: String) -> Result<(), String> {
    let rich = rich::render(&text);
    // macOS'ta NSPasteboard ana iş parçacığından kullanılmalı.
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(clipboard::write(&rich));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // İkinci kez başlatılırsa yeni süreç açma; tepsideki pencereyi öne getir.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main(app)
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Recorder::default())
        .manage(Engine::default())
        .setup(|app| {
            app.manage(SettingsStore::load(app.handle()));
            whisper::init(app.handle().clone());
            tray::install(app)?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            default_prompt_config,
            list_microphones,
            model_status,
            download_model,
            start_recording,
            stop_and_transcribe,
            process_report,
            copy_report,
            list_models,
        ])
        .build(tauri::generate_context!())
        .expect("Hilus başlatılamadı")
        .run(|app, event| {
            // macOS: Dock simgesine tıklanınca gizli pencereyi geri getir.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
