//! `**...**` işaretli rapor metninden RTF, HTML ve düz metin üretir
//! (mantık docs/handy-kalin.ahk ile aynı).

use std::sync::LazyLock;

use regex::Regex;

static BOLD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\*\*(.+?)\*\*").unwrap());

pub struct RichText {
    pub rtf: String,
    pub html: String,
    pub plain: String,
}

pub fn render(text: &str) -> RichText {
    let text = text.replace("\r\n", "\n");
    RichText {
        rtf: to_rtf(&text),
        html: to_html(&text),
        plain: BOLD.replace_all(&text, "$1").into_owned(),
    }
}

fn to_html(text: &str) -> String {
    let escaped = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    BOLD.replace_all(&escaped, "<b>$1</b>").replace('\n', "<br>")
}

/// Hastane rapor programı yalnızca RTF kalınını tanıdığı için asıl biçim budur.
/// Yazı tipi tablosu yok: hedef program kendi varsayılan yazı tipini kullanır.
fn to_rtf(text: &str) -> String {
    let mut out = String::from("{\\rtf1\\ansi\\uc1 ");
    let mut last = 0;
    for caps in BOLD.captures_iter(text) {
        let whole = caps.get(0).unwrap();
        push_rtf_text(&mut out, &text[last..whole.start()]);
        out.push_str("{\\b ");
        push_rtf_text(&mut out, &caps[1]);
        out.push('}');
        last = whole.end();
    }
    push_rtf_text(&mut out, &text[last..]);
    out.push('}');
    out
}

fn push_rtf_text(out: &mut String, text: &str) {
    for c in text.chars() {
        match c {
            '\\' | '{' | '}' => {
                out.push('\\');
                out.push(c);
            }
            '\n' => out.push_str("\\par\r\n"),
            '\r' => {}
            c if (c as u32) < 128 => out.push(c),
            c => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    out.push_str(&format!("\\u{}?", *unit as i16));
                }
            }
        }
    }
}

/// Windows "HTML Format" (CF_HTML) başlığı; ofsetler UTF-8 bayt cinsindendir.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn cf_html(fragment: &str) -> String {
    const PRE: &str = "<html><head><meta charset=\"utf-8\"></head><body><!--StartFragment-->";
    const POST: &str = "<!--EndFragment--></body></html>";
    let header = |a: usize, b: usize, c: usize, d: usize| {
        format!(
            "Version:0.9\r\nStartHTML:{a:010}\r\nEndHTML:{b:010}\r\nStartFragment:{c:010}\r\nEndFragment:{d:010}\r\n"
        )
    };
    let start_html = header(0, 0, 0, 0).len();
    let start_frag = start_html + PRE.len();
    let end_frag = start_frag + fragment.len();
    let end_html = end_frag + POST.len();
    format!(
        "{}{PRE}{fragment}{POST}",
        header(start_html, end_html, start_frag, end_frag)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bold_and_turkish_in_rtf() {
        let r = render("Normal satır.\n**Sol böbrekte kist izlenmiştir.**");
        assert_eq!(
            r.rtf,
            "{\\rtf1\\ansi\\uc1 Normal sat\\u305?r.\\par\r\n{\\b Sol b\\u246?brekte kist izlenmi\\u351?tir.}}"
        );
        assert_eq!(r.plain, "Normal satır.\nSol böbrekte kist izlenmiştir.");
        assert_eq!(
            r.html,
            "Normal satır.<br><b>Sol böbrekte kist izlenmiştir.</b>"
        );
    }

    #[test]
    fn cf_html_offsets_point_at_fragment() {
        let frag = "<b>ğü</b>";
        let doc = cf_html(frag);
        let num = |key: &str| -> usize {
            let i = doc.find(key).unwrap() + key.len();
            doc[i..i + 10].parse().unwrap()
        };
        assert_eq!(&doc[num("StartFragment:")..num("EndFragment:")], frag);
        assert_eq!(num("EndHTML:"), doc.len());
    }
}
