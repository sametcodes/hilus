//! Mikrofon kaydı. Ses yalnızca bellekte tutulur; diske hiçbir şey yazılmaz.
//!
//! cpal akışları bazı platformlarda `Send` olmadığı için her kayıt kendi iş
//! parçacığında açılır; kontrol bir kanal üzerinden yapılır.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use tauri::{AppHandle, Emitter};

/// Whisper'ın beklediği örnekleme hızı.
pub const TARGET_RATE: u32 = 16_000;

struct Captured {
    samples: Vec<f32>,
    rate: u32,
}

struct ActiveRecording {
    stop_tx: Sender<()>,
    handle: JoinHandle<Result<Captured, String>>,
}

#[derive(Default)]
pub struct Recorder {
    active: Mutex<Option<ActiveRecording>>,
}

pub fn list_input_devices() -> Vec<String> {
    let host = cpal::default_host();
    let Ok(devices) = host.input_devices() else {
        return Vec::new();
    };
    devices.filter_map(|d| device_name(&d)).collect()
}

fn device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|d| d.name().to_string())
}

fn pick_device(preferred: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(name) = preferred.filter(|n| !n.is_empty()) {
        if let Ok(mut devices) = host.input_devices() {
            if let Some(d) = devices.find(|d| device_name(d).as_deref() == Some(name)) {
                return Ok(d);
            }
        }
    }
    host.default_input_device()
        .ok_or_else(|| "Mikrofon bulunamadı.".to_string())
}

impl Recorder {
    pub fn start(&self, app: AppHandle, mic: Option<String>) -> Result<(), String> {
        let mut active = self.active.lock().map_err(|e| e.to_string())?;
        if active.is_some() {
            return Ok(());
        }
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let handle = std::thread::spawn(move || record_thread(app, mic, stop_rx, ready_tx));
        match ready_rx.recv() {
            Ok(Ok(())) => {
                *active = Some(ActiveRecording { stop_tx, handle });
                Ok(())
            }
            Ok(Err(e)) => {
                let _ = handle.join();
                Err(e)
            }
            Err(_) => Err("Kayıt başlatılamadı.".into()),
        }
    }

    /// Kaydı durdurur ve 16 kHz mono örnekleri döndürür.
    pub fn stop(&self) -> Result<Vec<f32>, String> {
        let rec = self
            .active
            .lock()
            .map_err(|e| e.to_string())?
            .take()
            .ok_or_else(|| "Aktif kayıt yok.".to_string())?;
        let _ = rec.stop_tx.send(());
        let captured = rec
            .handle
            .join()
            .map_err(|_| "Kayıt iş parçacığı çöktü.".to_string())??;
        Ok(resample(&captured.samples, captured.rate, TARGET_RATE))
    }
}

fn record_thread(
    app: AppHandle,
    mic: Option<String>,
    stop_rx: mpsc::Receiver<()>,
    ready_tx: Sender<Result<(), String>>,
) -> Result<Captured, String> {
    let buffer: Arc<Mutex<Vec<f32>>> = Arc::default();
    let level = Arc::new(AtomicU32::new(0));
    let opened = open_stream(mic.as_deref(), Arc::clone(&buffer), Arc::clone(&level));
    let (stream, rate) = match opened {
        Ok(v) => v,
        Err(e) => {
            let _ = ready_tx.send(Err(e.clone()));
            return Err(e);
        }
    };
    let _ = ready_tx.send(Ok(()));

    // Kayıt sürerken ses seviyesini arayüze bildir (seviye göstergesi için).
    loop {
        match stop_rx.recv_timeout(Duration::from_millis(80)) {
            Err(RecvTimeoutError::Timeout) => {
                let _ = app.emit("mic-level", f32::from_bits(level.load(Ordering::Relaxed)));
            }
            _ => break,
        }
    }
    drop(stream);
    let samples = std::mem::take(&mut *buffer.lock().map_err(|e| e.to_string())?);
    Ok(Captured { samples, rate })
}

fn open_stream(
    mic: Option<&str>,
    buffer: Arc<Mutex<Vec<f32>>>,
    level: Arc<AtomicU32>,
) -> Result<(cpal::Stream, u32), String> {
    let device = pick_device(mic)?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("Mikrofon yapılandırması alınamadı: {e}"))?;
    let rate = config.sample_rate();
    let channels = config.channels() as usize;
    let format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();

    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, &stream_config, channels, buffer, level),
        SampleFormat::I16 => build::<i16>(&device, &stream_config, channels, buffer, level),
        SampleFormat::I32 => build::<i32>(&device, &stream_config, channels, buffer, level),
        SampleFormat::U16 => build::<u16>(&device, &stream_config, channels, buffer, level),
        SampleFormat::I8 => build::<i8>(&device, &stream_config, channels, buffer, level),
        other => return Err(format!("Desteklenmeyen ses biçimi: {other}")),
    }?;
    stream
        .play()
        .map_err(|e| format!("Mikrofon başlatılamadı: {e}"))?;
    Ok((stream, rate))
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    channels: usize,
    buffer: Arc<Mutex<Vec<f32>>>,
    level: Arc<AtomicU32>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = channels.max(1);
    device
        .build_input_stream(
            config.clone(),
            move |data: &[T], _: &_| {
                let mut peak = 0f32;
                let Ok(mut buf) = buffer.lock() else { return };
                for frame in data.chunks(channels) {
                    let sum: f32 = frame.iter().map(|s| s.to_sample::<f32>()).sum();
                    let mono = sum / frame.len() as f32;
                    peak = peak.max(mono.abs());
                    buf.push(mono);
                }
                level.store(peak.to_bits(), Ordering::Relaxed);
            },
            |err| eprintln!("ses akışı hatası: {err}"),
            None,
        )
        .map_err(|e| format!("Mikrofon akışı açılamadı: {e}"))
}

/// Basit yeniden örnekleme: indirgemede kutu filtresi (örtüşmeyi azaltır) +
/// doğrusal ara değerleme. Konuşma tanıma için yeterli.
pub(crate) fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let window = ratio.floor().max(1.0) as usize;
    let smoothed: Vec<f32> = if window > 1 {
        let mut acc = 0f32;
        let mut out = Vec::with_capacity(input.len());
        for (i, s) in input.iter().enumerate() {
            acc += s;
            if i >= window {
                acc -= input[i - window];
            }
            out.push(acc / window.min(i + 1) as f32);
        }
        out
    } else {
        input.to_vec()
    };
    let out_len = (input.len() as f64 / ratio).floor() as usize;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;
            let a = smoothed[idx.min(smoothed.len() - 1)];
            let b = smoothed[(idx + 1).min(smoothed.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kayıt yolunun (kanal ortalaması + `resample`) çıktısını WAV'a yazar; çıktı
    /// `fallback_compare` ile çözümlenebilir. Çalıştırma:
    /// HILUS_TEST_RAW=ham.wav HILUS_TEST_OUT=cikti.wav cargo test -- --ignored capture_pipeline
    #[test]
    #[ignore]
    fn capture_pipeline() {
        let mut reader = hound::WavReader::open(std::env::var("HILUS_TEST_RAW").unwrap()).unwrap();
        let spec = reader.spec();
        let channels = spec.channels as usize;
        let data: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader.samples::<f32>().map(|s| s.unwrap()).collect(),
            hound::SampleFormat::Int => reader.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect(),
        };
        let mono: Vec<f32> = data.chunks(channels).map(|f| f.iter().sum::<f32>() / f.len() as f32).collect();
        let out = resample(&mono, spec.sample_rate, TARGET_RATE);
        let spec_out = hound::WavSpec {
            channels: 1,
            sample_rate: TARGET_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(std::env::var("HILUS_TEST_OUT").unwrap(), spec_out).unwrap();
        for s in out {
            writer.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).unwrap();
        }
        writer.finalize().unwrap();
        println!("{} Hz {} kanal → 16 kHz mono", spec.sample_rate, channels);
    }
}
