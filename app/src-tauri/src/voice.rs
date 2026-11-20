use std::error::Error;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, State};
use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub const MODEL_FILE: &str = "ggml-large-v3-turbo-q5_0.bin";
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
const BILINGUAL_PROMPT: &str = "Kun je de API aanpassen en de tests draaien? Please fix the bug, update the README and merge the branch.";

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Download {
    pub received: u64,
    pub total: u64,
}

pub struct Voice {
    model: PathBuf,
    download: Mutex<()>,
    context: Mutex<Option<Arc<WhisperContext>>>,
}

impl Voice {
    pub fn new(model: PathBuf) -> Self {
        whisper_rs::install_logging_hooks();
        Voice {
            model,
            download: Mutex::new(()),
            context: Mutex::new(None),
        }
    }

    pub fn ensure_model(&self, progress: impl Fn(Download)) -> Result<(), String> {
        let _only_one = self.download.lock().unwrap();
        if self.model.exists() {
            return Ok(());
        }
        download(MODEL_URL, &self.model, progress)
            .map_err(|error| format!("download {MODEL_URL}: {error}"))
    }

    pub fn transcribe(&self, samples: &[f32]) -> Result<String, String> {
        let context = self.context()?;
        let mut state = context.create_state().map_err(|error| error.to_string())?;
        state
            .full(params(), samples)
            .map_err(|error| format!("transcribe {} samples: {error}", samples.len()))?;
        let text: String = state.as_iter().map(|segment| segment.to_string()).collect();
        Ok(text.trim().to_string())
    }

    fn context(&self) -> Result<Arc<WhisperContext>, String> {
        let mut slot = self.context.lock().unwrap();
        if let Some(context) = slot.as_ref() {
            return Ok(context.clone());
        }
        let context =
            WhisperContext::new_with_params(&self.model, WhisperContextParameters::default())
                .map_err(|error| format!("load {}: {error}", self.model.display()))?;
        let context = Arc::new(context);
        *slot = Some(context.clone());
        Ok(context)
    }
}

fn params() -> FullParams<'static, 'static> {
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: -1.0,
    });
    params.set_language(Some("auto"));
    params.set_initial_prompt(BILINGUAL_PROMPT);
    params.set_no_timestamps(true);
    params.set_suppress_nst(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    let threads = std::thread::available_parallelism().map_or(4, |count| count.get().min(8));
    params.set_n_threads(threads as i32);
    params
}

fn download(url: &str, to: &Path, progress: impl Fn(Download)) -> Result<(), Box<dyn Error>> {
    let tls = TlsConfig::builder()
        .provider(TlsProvider::NativeTls)
        .root_certs(RootCerts::PlatformVerifier)
        .build();
    let agent: ureq::Agent = ureq::Agent::config_builder().tls_config(tls).build().into();
    let response = agent.get(url).call()?;
    let total = response
        .body()
        .content_length()
        .ok_or("the server sent no content length")?;
    let mut body = response.into_body().into_reader();
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir)?;
    }
    let part = to.with_extension("part");
    let mut file = File::create(&part)?;
    let mut buffer = vec![0; 1 << 16];
    let mut received = 0;
    let mut reported = 0;
    progress(Download { received, total });
    loop {
        let read = body.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])?;
        received += read as u64;
        if received * 100 / total > reported {
            reported = received * 100 / total;
            progress(Download { received, total });
        }
    }
    if received != total {
        return Err(format!("received {received} of {total} bytes").into());
    }
    file.sync_all()?;
    fs::rename(&part, to)?;
    Ok(())
}

fn samples(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

#[tauri::command(async)]
pub fn prepare_dictation(app: AppHandle, voice: State<'_, Arc<Voice>>) -> Result<(), String> {
    voice.ensure_model(|download| {
        if let Err(error) = app.emit("dictation-download", download) {
            eprintln!("emit: {error}");
        }
    })
}

#[tauri::command(async)]
pub fn transcribe(voice: State<'_, Arc<Voice>>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("transcribe: expected raw 16 kHz f32 audio".to_string());
    };
    voice.transcribe(&samples(bytes))
}
