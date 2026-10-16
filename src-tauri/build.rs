fn main() {
    link_clang_runtime_on_macos();
    tauri_build::build()
}

/// ggml'in Metal kodu yeni API'leri `@available(...)` ile denetler; derleyici bunun için
/// `__isPlatformVersionAtLeast` çağrısı üretir. Bu sembol clang'ın çalışma zamanı
/// kütüphanesinde (libclang_rt.osx.a) durur ve rustc `-nodefaultlibs` ile bağladığı için
/// kendiliğinden eklenmez; yeni Xcode sürümlerinde bağlama "Undefined symbols" ile düşer.
fn link_clang_runtime_on_macos() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let Ok(output) = std::process::Command::new("clang")
        .arg("--print-runtime-dir")
        .output()
    else {
        return;
    };
    let dir = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if std::path::Path::new(&dir).join("libclang_rt.osx.a").is_file() {
        println!("cargo:rustc-link-search=native={dir}");
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
}
