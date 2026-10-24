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

/// Rapor için denenecek bir model ve kendi anahtarı. Aynı sağlayıcıdan farklı
/// anahtarlarla (ör. farklı harcama sınırlarıyla) birden fazla satır olabilir.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelChoice {
    /// "anthropic" | "gemini" | "openai"
    pub provider: String,
    pub model: String,
    /// Boşsa sağlayıcının eski ortak anahtar alanı kullanılır.
    pub api_key: String,
    /// Yalnızca OpenAI-uyumlu için; boşsa ortak adres alanı kullanılır.
    pub base_url: String,
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
    /// İşle'de sırayla denenecek modeller; biri hata verirse sıradakine geçilir.
    /// `None` = bu alanı tanımayan eski bir ayar dosyası: anahtarı girilmiş eski
    /// tek sağlayıcı ayarı sıranın tek satırı olur. Yeni kurulumda sıra boştur.
    #[serde(default)]
    pub model_chain: Option<Vec<ModelChoice>>,
    pub whisper_prompt: String,
    /// Whisper'ın konuşma dili (ISO kodu, ör. "tr", "en") ya da "auto" (otomatik algıla).
    pub whisper_language: String,
    /// Kararlı çözümleme: sıcaklık geri dönüşü kapalı; yabancı harfli ya da
    /// tekrar döngüsüne giren çıktı "Anlaşılamadı" hatası olur.
    pub whisper_strict: bool,
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
            model_chain: Some(Vec::new()),
            whisper_prompt: DEFAULT_WHISPER_PROMPT.into(),
            whisper_language: DEFAULT_WHISPER_LANGUAGE.into(),
            whisper_strict: false,
            microphone: None,
            auto_update_check: true,
            sound_feedback: true,
            prompt: PromptConfig::default(),
        }
    }
}

pub const DEFAULT_WHISPER_LANGUAGE: &str = "tr";

impl Settings {
    /// Denenecek modeller, sırasıyla. Modeli boş satırlar atlanır; boş olabilir.
    pub fn chain(&self) -> Vec<ModelChoice> {
        let Some(chain) = &self.model_chain else {
            return self.legacy_choice().into_iter().collect();
        };
        chain
            .iter()
            .filter(|c| !c.model.trim().is_empty())
            .map(|c| self.with_shared_credentials(c.clone()))
            .collect()
    }

    /// Eski ayar dosyasındaki tek sağlayıcı, anahtarı girilmişse.
    fn legacy_choice(&self) -> Option<ModelChoice> {
        let (model, key) = match self.provider.as_str() {
            "gemini" => (&self.gemini_model, &self.gemini_key),
            "openai" => (&self.openai_model, &self.openai_key),
            _ => (&self.anthropic_model, &self.anthropic_key),
        };
        if key.trim().is_empty() || model.trim().is_empty() {
            return None;
        }
        Some(self.with_shared_credentials(ModelChoice {
            provider: self.provider.clone(),
            model: model.clone(),
            ..Default::default()
        }))
    }

    /// Satırın boş anahtar/adres alanlarını sağlayıcının ortak alanlarıyla doldurur.
    fn with_shared_credentials(&self, mut c: ModelChoice) -> ModelChoice {
        if c.api_key.trim().is_empty() {
            c.api_key = match c.provider.as_str() {
                "gemini" => &self.gemini_key,
                "openai" => &self.openai_key,
                _ => &self.anthropic_key,
            }
            .clone();
        }
        if c.provider == "openai" && c.base_url.trim().is_empty() {
            c.base_url = self.openai_base_url.clone();
        }
        c
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eski_ayarlarda_dil_yoksa_turkce() {
        let s: Settings = serde_json::from_str(r#"{"provider":"gemini","whisperPrompt":"x"}"#).unwrap();
        assert_eq!(s.whisper_language, "tr");
        assert!(!s.whisper_strict);
        assert_eq!(s.provider, "gemini");
    }

    #[test]
    fn yeni_kurulumda_model_yok() {
        assert!(Settings::default().chain().is_empty());
        let s: Settings = serde_json::from_str(r#"{"modelChain":[]}"#).unwrap();
        assert!(s.chain().is_empty());
        // Eski dosya ama anahtar hiç girilmemiş: taşınacak bir şey yok.
        let s: Settings = serde_json::from_str(r#"{"provider":"anthropic"}"#).unwrap();
        assert!(s.chain().is_empty());
    }

    #[test]
    fn zincir_yoksa_eski_saglayici() {
        let s: Settings =
            serde_json::from_str(r#"{"provider":"gemini","geminiModel":"gemini-2.5-flash","geminiKey":"k"}"#).unwrap();
        let chain = s.chain();
        assert_eq!(chain.len(), 1);
        assert_eq!((chain[0].provider.as_str(), chain[0].model.as_str()), ("gemini", "gemini-2.5-flash"));
    }

    #[test]
    fn satir_anahtari_yoksa_ortak_anahtar() {
        let s: Settings = serde_json::from_str(
            r#"{"anthropicKey":"ortak","modelChain":[{"provider":"anthropic","model":"a"},{"provider":"anthropic","model":"a","apiKey":"ikinci"}]}"#,
        )
        .unwrap();
        let keys: Vec<_> = s.chain().into_iter().map(|c| c.api_key).collect();
        assert_eq!(keys, ["ortak", "ikinci"]);
    }

    #[test]
    fn zincir_sirasi_korunur_bos_model_atlanir() {
        let s: Settings = serde_json::from_str(
            r#"{"modelChain":[{"provider":"gemini","model":"gemini-2.5-flash"},{"provider":"openai","model":" "},{"provider":"anthropic","model":"claude-haiku-5-5"}]}"#,
        )
        .unwrap();
        let providers: Vec<_> = s.chain().into_iter().map(|c| c.provider).collect();
        assert_eq!(providers, ["gemini", "anthropic"]);
    }

    #[test]
    fn kayitli_dil_korunur() {
        let s: Settings = serde_json::from_str(r#"{"whisperLanguage":"auto"}"#).unwrap();
        assert_eq!(s.whisper_language, "auto");
    }
}
