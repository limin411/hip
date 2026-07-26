fn main() {
    // Expose TARGET triple to the crate (for resources/whisper/<triple>/whisper-cli).
    if let Ok(t) = std::env::var("TARGET") {
        println!("cargo:rustc-env=TARGET={t}");
    }
    tauri_build::build()
}
