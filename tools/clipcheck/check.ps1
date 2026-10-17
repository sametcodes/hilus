# clipcheck'in panoya yazdığı raporu doğrular ve gerçek bir Windows RichEdit denetimine
# (RichTextBox) yapıştırıp kalının korunup korunmadığına bakar.
# Windows PowerShell 5.1 (STA) ile çalışır; UTF-8 BOM'lu kaydedilmeli.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$fail = @()
$data = [Windows.Forms.Clipboard]::GetDataObject()
$formats = $data.GetFormats()
Write-Host "Panodaki biçimler: $($formats -join ', ')"

if ($formats -notcontains 'Rich Text Format') { $fail += 'Panoda RTF yok' }
if ($formats -notcontains 'HTML Format') { $fail += 'Panoda HTML yok' }

$rtf = [string]$data.GetData('Rich Text Format')
Write-Host "RTF: $rtf"
if ($rtf -notmatch '\{\\b ') { $fail += 'RTF içinde kalın yok' }

$html = [string]$data.GetData('HTML Format')
Write-Host "HTML: $html"
if ($html -notmatch '<b>') { $fail += 'HTML içinde <b> yok' }

$plain = [Windows.Forms.Clipboard]::GetText()
if ($plain -match '\*\*') { $fail += 'Düz metinde ** kalmış' }

$box = New-Object Windows.Forms.RichTextBox
$null = $box.Handle
$box.Paste()
Write-Host "Yapıştırılan metin: $($box.Text)"

function Test-Bold([string]$word) {
    $i = $box.Text.IndexOf($word)
    if ($i -lt 0) { return $null }
    $box.Select($i, $word.Length)
    return $box.SelectionFont.Bold
}

$positive = Test-Bold 'hematom'
$normal = Test-Bold 'Normal'
if ($null -eq $positive) { $fail += 'Pozitif bulgu yapıştırılan metinde yok' }
elseif (-not $positive) { $fail += 'Pozitif bulgu yapıştırınca kalın değil' }
if ($normal) { $fail += 'Normal satır kalın yapıştı' }
if (-not $box.Text.Contains('Sağ frontal')) { $fail += 'Türkçe karakterler bozuk yapıştı' }

if ($fail.Count) {
    $fail | ForEach-Object { Write-Host "HATA: $_" }
    exit 1
}
Write-Host 'Tamam: RTF ve HTML panoda, RichTextBox''a yapıştırınca yalnızca pozitif bulgu kalın.'
