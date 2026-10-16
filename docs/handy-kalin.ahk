; Handy kalın yapıştırma — AutoHotkey v2
; **...** ile işaretli cümleleri gerçek kalın yazıya çevirip zengin metin olarak yapıştırır.
;
; İki kullanım:
;  1) Handy "External script" yapıştırma yöntemi: derlenmiş .exe'yi Handy'ye gösterin.
;     Handy metni ilk argüman olarak verir; script yapıştırır ve kapanır.
;  2) Kısayol: .ahk dosyasını çalışır bırakın; Handy metni panoya koyduktan sonra
;     Ctrl+Alt+V panodaki metni kalın biçimle yapıştırır.

#Requires AutoHotkey v2.0
#SingleInstance Force

if (A_Args.Length > 0) {
    PasteRich(A_Args[1])
    ExitApp
}

^!v:: PasteRich(A_Clipboard)

PasteRich(text) {
    text := StrReplace(text, "`r`n", "`n")
    if (Trim(text) = "")
        return
    plain := RegExReplace(text, "\*\*(.+?)\*\*", "$1")
    if !SetRichClipboard(ToHtml(text), ToRtf(text), plain)
        return
    Send "^v"
    Sleep 500
}

ToHtml(text) {
    h := StrReplace(text, "&", "&amp;")
    h := StrReplace(h, "<", "&lt;")
    h := StrReplace(h, ">", "&gt;")
    h := RegExReplace(h, "\*\*(.+?)\*\*", "<b>$1</b>")
    return StrReplace(h, "`n", "<br>")
}

ToRtf(text) {
    marked := RegExReplace(text, "\*\*(.+?)\*\*", Chr(1) "$1" Chr(2))
    out := ""
    Loop Parse, marked {
        c := A_LoopField
        n := Ord(c)
        if (c = "\" || c = "{" || c = "}")
            out .= "\" c
        else if (n = 1)
            out .= "{\b "
        else if (n = 2)
            out .= "}"
        else if (c = "`n")
            out .= "\par`r`n"
        else if (n > 127)
            out .= "\u" (n > 32767 ? n - 65536 : n) "?"
        else
            out .= c
    }
    return "{\rtf1\ansi\uc1 " out "}"
}

BuildCfHtml(fragment) {
    pre := '<html><head><meta charset="utf-8"></head><body><!--StartFragment-->'
    post := "<!--EndFragment--></body></html>"
    hdr := "Version:0.9`r`nStartHTML:{1:010d}`r`nEndHTML:{2:010d}`r`nStartFragment:{3:010d}`r`nEndFragment:{4:010d}`r`n"
    startHtml := StrLen(Format(hdr, 0, 0, 0, 0))
    startFrag := startHtml + Utf8Len(pre)
    endFrag := startFrag + Utf8Len(fragment)
    endHtml := endFrag + Utf8Len(post)
    return Format(hdr, startHtml, endHtml, startFrag, endFrag) pre fragment post
}

Utf8Len(s) => StrPut(s, "UTF-8") - 1

SetRichClipboard(html, rtf, plain) {
    fmtHtml := DllCall("RegisterClipboardFormat", "Str", "HTML Format", "UInt")
    fmtRtf := DllCall("RegisterClipboardFormat", "Str", "Rich Text Format", "UInt")
    Loop 10 {
        if DllCall("OpenClipboard", "Ptr", A_ScriptHwnd)
            break
        if (A_Index = 10)
            return false
        Sleep 50
    }
    DllCall("EmptyClipboard")
    PutClip(fmtHtml, BuildCfHtml(html), "UTF-8")
    PutClip(fmtRtf, rtf, "CP0")
    PutClip(13, plain, "UTF-16")
    DllCall("CloseClipboard")
    return true
}

PutClip(fmt, str, enc) {
    size := StrPut(str, enc)
    hMem := DllCall("GlobalAlloc", "UInt", 0x42, "UPtr", size, "Ptr")
    StrPut(str, DllCall("GlobalLock", "Ptr", hMem, "Ptr"), , enc)
    DllCall("GlobalUnlock", "Ptr", hMem)
    DllCall("SetClipboardData", "UInt", fmt, "Ptr", hMem)
}
