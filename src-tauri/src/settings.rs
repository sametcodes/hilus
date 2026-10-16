//! Ayarlar — uygulamanın diske yazdığı TEK veri. Dikte, ses ve rapor buraya girmez.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const PROMPT_DEFAULTS: &str = include_str!("../defaults/prompt-defaults.json");

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub tag: String,
    pub name: String,
    pub keywords: Vec<String>,
    pub body: String,
    pub abbreviations: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellingEntry {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptConfig {
    pub intro: String,
    pub mode_intro: String,
    pub mode_fallback: String,
    pub template_rules: String,
    pub abbreviations_intro: String,
    pub spelling_intro: String,
    pub spelling_empty: String,
    pub general_rules: String,
    pub output_rule: String,
    pub templates: Vec<Template>,
    pub spelling: Vec<SpellingEntry>,
}

impl Default for PromptConfig {
    fn default() -> Self {
        serde_json::from_str(PROMPT_DEFAULTS).expect("prompt-defaults.json geçersiz")
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// "anthropic" | "gemini" | "openai"
    pub provider: String,
    pub anthropic_model: String,
    pub anthropic_key: String,
    pub gemini_model: String,
    pub gemini_key: String,
    pub openai_base_url: String,
    pub openai_model: String,
    pub openai_key: String,
    pub whisper_prompt: String,
    pub microphone: Option<String>,
    /// Açılışta GitHub Releases'ta yeni sürüm var mı diye bak.
    pub auto_update_check: bool,
    /// Kayıt başlarken ve biterken kısa uyarı sesi.
    pub sound_feedback: bool,
    pub prompt: PromptConfig,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            provider: "anthropic".into(),
            anthropic_model: "claude-haiku-5-5".into(),
            anthropic_key: String::new(),
            gemini_model: "gemini-3.6-flash".into(),
            gemini_key: String::new(),
            openai_base_url: "https://api.openai.com/v1".into(),
            openai_model: String::new(),
            openai_key: String::new(),
            whisper_prompt: DEFAULT_WHISPER_PROMPT.into(),
            microphone: None,
            auto_update_check: true,
            sound_feedback: true,
            prompt: PromptConfig::default(),
        }
    }
}

/// Whisper'a bağlam: talimat değil, doktorun dikte üslubuna benzeyen örnek cümleler.
const DEFAULT_WHISPER_PROMPT: &str = "Acil toraks BT kontrastsız, klinik nefes darlığı. \
Sağ akciğer alt lobda konsolidasyon, bilateral plevral effüzyon. \
Batın BT kontrastlı, hepatosteatoz, safra kesesi opere, sol böbrek alt polde 20 mm kortikal kist. \
Kranial BT, atrofi, iskemik gliotik değişiklikler. Paranazal sinüs, orbita, temporal kemik. \
Pulmoner BT anjiyo, sağ alt lob segmenter emboli. Sürrenal, parankim, hiler, aterosklerotik, \
paraaortik lenf nodu, L4-L5. Sonuç.";

pub struct SettingsStore {
    pub current: Mutex<Settings>,
    path: Option<PathBuf>,
}

impl SettingsStore {
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_config_dir()
            .ok()
            .map(|d| d.join("settings.json"));
        let current = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .unwrap_or_default();
        SettingsStore {
            current: Mutex::new(current),
            path,
        }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn save(&self, settings: Settings) -> Result<(), String> {
        let path = self.path.as_ref().ok_or("Ayar klasörü bulunamadı.")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        *self.current.lock().map_err(|e| e.to_string())? = settings;
        Ok(())
    }
}
