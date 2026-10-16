import { invoke } from "@tauri-apps/api/core";
import type { ModelInfo, ModelStatus, PromptConfig, Settings } from "./types";

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  defaultPromptConfig: () => invoke<PromptConfig>("default_prompt_config"),
  listMicrophones: () => invoke<string[]>("list_microphones"),
  modelStatus: () => invoke<ModelStatus>("model_status"),
  downloadModel: () => invoke<void>("download_model"),
  startRecording: () => invoke<void>("start_recording"),
  stopAndTranscribe: () => invoke<string>("stop_and_transcribe"),
  processReport: (prompt: string) => invoke<string>("process_report", { prompt }),
  copyReport: (text: string) => invoke<void>("copy_report", { text }),
  listModels: (provider: string, apiKey: string, baseUrl: string) =>
    invoke<ModelInfo[]>("list_models", { provider, apiKey, baseUrl }),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
