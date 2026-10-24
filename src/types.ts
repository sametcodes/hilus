export interface Template {
  tag: string;
  name: string;
  keywords: string[];
  body: string;
  abbreviations: string;
}

export interface SpellingEntry {
  from: string;
  to: string;
}

export interface PromptConfig {
  intro: string;
  modeIntro: string;
  modeFallback: string;
  templateRules: string;
  abbreviationsIntro: string;
  spellingIntro: string;
  spellingEmpty: string;
  generalRules: string;
  outputRule: string;
  templates: Template[];
  spelling: SpellingEntry[];
}

export type Provider = "anthropic" | "gemini" | "openai";

/** Rapor için denenecek bir model ve kendi anahtarı (aynı sağlayıcıdan farklı anahtarlı satırlar olabilir). */
export interface ModelChoice {
  provider: Provider;
  model: string;
  apiKey: string;
  /** Yalnızca OpenAI-uyumlu için. */
  baseUrl: string;
}

/** İşle'nin sonucu: metin, onu yazan model ve önceki modellerin hataları. */
export interface Completion {
  text: string;
  provider: Provider;
  model: string;
  failures: string[];
}

export interface Settings {
  /** Eski tek sağlayıcı alanı; kaydederken model sırasının ilkiyle eşitlenir. */
  provider: Provider;
  anthropicModel: string;
  anthropicKey: string;
  geminiModel: string;
  geminiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiKey: string;
  /** İşle'de sırayla denenen modeller; biri hata verirse sıradakine geçilir. null = alanı tanımayan eski ayar dosyası. */
  modelChain: ModelChoice[] | null;
  whisperPrompt: string;
  /** ISO kodu ("tr", "en") ya da "auto". */
  whisperLanguage: string;
  whisperStrict: boolean;
  microphone: string | null;
  autoUpdateCheck: boolean;
  soundFeedback: boolean;
  prompt: PromptConfig;
}

export type ModelStatus =
  | { state: "checking" }
  | { state: "missing" }
  | { state: "downloading"; downloaded: number; total: number }
  | { state: "loading"; path: string }
  | { state: "ready"; path: string; backend: string }
  | { state: "error"; message: string };

export interface Part {
  id: number;
  text: string;
  included: boolean;
  pending: boolean;
  editing: boolean;
}

export interface ModelInfo {
  id: string;
  label: string;
}
