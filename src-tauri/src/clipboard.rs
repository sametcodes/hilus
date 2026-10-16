//! Panoya aynı anda RTF + HTML + düz metin yazar.

use crate::rich::RichText;

#[cfg(target_os = "macos")]
pub fn write(rich: &RichText) -> Result<(), String> {
    use objc2_app_kit::{
        NSPasteboard, NSPasteboardTypeHTML, NSPasteboardTypeRTF, NSPasteboardTypeString,
    };
    use objc2_foundation::{NSData, NSString};

    let html = format!("<meta charset=\"utf-8\">{}", rich.html);
    let pb = NSPasteboard::generalPasteboard();
    pb.clearContents();
    let ok = unsafe {
        pb.setData_forType(Some(&NSData::with_bytes(rich.rtf.as_bytes())), NSPasteboardTypeRTF)
            & pb.setString_forType(&NSString::from_str(&html), NSPasteboardTypeHTML)
            & pb.setString_forType(&NSString::from_str(&rich.plain), NSPasteboardTypeString)
    };
    ok.then_some(()).ok_or_else(|| "Panoya yazılamadı.".into())
}

#[cfg(windows)]
pub fn write(rich: &RichText) -> Result<(), String> {
    use clipboard_win::{options::NoClear, raw, register_format, Clipboard};

    let err = |e: clipboard_win::ErrorCode| format!("Panoya yazılamadı: {e}");
    let _clip = Clipboard::new_attempts(10).map_err(err)?;
    raw::empty().map_err(err)?;
    let html_fmt = register_format("HTML Format").ok_or("HTML biçimi kaydedilemedi.")?;
    let rtf_fmt = register_format("Rich Text Format").ok_or("RTF biçimi kaydedilemedi.")?;
    let mut html = crate::rich::cf_html(&rich.html).into_bytes();
    html.push(0);
    raw::set_without_clear(html_fmt.get(), &html).map_err(err)?;
    let mut rtf = rich.rtf.clone().into_bytes();
    rtf.push(0);
    raw::set_without_clear(rtf_fmt.get(), &rtf).map_err(err)?;
    raw::set_string_with(&rich.plain, NoClear).map_err(err)?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn write(_rich: &RichText) -> Result<(), String> {
    Err("Bu platformda zengin pano desteklenmiyor.".into())
}
