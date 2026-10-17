//! Örnek bir raporu Hilus'un "Kopyala" düğmesiyle aynı kodla panoya yazar.
//! Panonun doğrulanması tools/clipcheck/check.ps1'de (Windows).

#[path = "../../../src-tauri/src/rich.rs"]
mod rich;
#[path = "../../../src-tauri/src/clipboard.rs"]
mod clipboard;

const SAMPLE: &str = "ACİL KRANİAL BT İNCELEMESİ\n\nBulgular:\nNormal satır.\n\
**Sağ frontal 12 mm kronik subdural hematom izlenmiştir.**\n\nDr.";

fn main() {
    match clipboard::write(&rich::render(SAMPLE)) {
        Ok(()) => println!("Örnek rapor panoya yazıldı."),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
