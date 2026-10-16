# Hilus

Radyolog için dikte toplayıcı. Doktor raporu 20 dakikaya yayılan, araya başka konuşmalar giren
parçalar hâlinde dikte eder; Hilus her parçayı yerelde Whisper ile yazıya döker, doktor gereksiz
parçaları ayıklar, işaretli parçalar **tek bir LLM isteğiyle** acil BT şablonuna oturtulur ve
sonuç hastane rapor programına kalın biçimi korunarak (RTF) yapıştırılır.

Tauri 2 (Rust) + sade TypeScript arayüz. macOS ve Windows hedeflenir.

## Akış

1. **Kayıt** — Pencere öndeyken **Space** basılı tutulur → mikrofon kaydı; bırakınca ses yerelde
   (transcribe.cpp, whisper-large-v3-turbo Q8_0, Türkçe) yazıya dökülür ve listeye parça olarak
   eklenir. Bir metin alanı düzenlenirken Space normal boşluktur. Kayıt sırasında **hiçbir LLM
   çağrısı yapılmaz.**
2. **Ayıklama** — Her parça: onay kutusu (dahil/hariç), Düzenle (çift tık da olur), Sil.
3. **İşle** (`⌘/Ctrl+Enter`) — İşaretli parçalar sırayla (satır satır) birleştirilip prompt'taki
   `${output}` yerine konur, seçili LLM'e tek istek gider. İşle'nin yanındaki **Şablon** seçimi:
   *Otomatik* (varsayılan) tüm şablonları gönderir, model dikte başındaki sözlerden seçer;
   tek bir şablon seçilirse yalnızca o şablon gönderilir; *Şablonsuz* yalnızca yazım düzeltir.
   Yanında gönderilecek prompt'un kaba token tahmini görünür (varsayılan ayarlarla Otomatik
   ≈ 4.850, tek şablon ≈ 1.700–2.300, şablonsuz ≈ 670 token). Seçim Kopyala'dan sonra
   Otomatik'e döner. Sonuç önizlemede gösterilir;
   `**...**` ile işaretli pozitif bulgu cümleleri kalın (ve hafif vurgulu) görünür. Önizleme
   “Düzenle” ile ham metin olarak elle düzeltilebilir.
4. **Kopyala** — Panoya aynı anda **RTF** (rapor programı yalnızca bunun kalınını tanıyor),
   **HTML** ve **düz metin** (yıldızsız) yazılır, ardından oturum temizlenir. Son rapor ve
   parçaları yalnızca bellekte tutulur; uygulama kapanana kadar **Geri al** ile kurtarılabilir.

## Sistem tepsisi

Pencereyi kapatmak uygulamayı kapatmaz: Hilus sistem tepsisinde (macOS'ta menü çubuğunda)
çalışmayı sürdürür, oturum bellekte kalır. Tepsi simgesine tıklamak pencereyi geri getirir;
sağ tık menüsünde “Hilus'u göster”, “Güncellemeleri denetle”, “Çık” var. macOS'ta pencere
gizliyken Dock simgesi de gizlenir. Uygulama ikinci kez başlatılırsa yeni kopya açılmaz,
mevcut pencere öne gelir.

## Sorun bildir

Üst çubuktaki **Sorun bildir** kısa bir açıklama ister ve GitHub'da (`sametcodes/hilus`)
`sorun-bildirimi` etiketli bir issue açar; doktorun GitHub hesabı gerekmez. Açıklamaya yalnızca
teknik bilgi eklenir (sürüm, işletim sistemi, Whisper durumu, sağlayıcı/model, şablon seçimi,
parça sayısı); dikte, rapor ve ses **gönderilmez**. Issue'lar herkese açık olduğundan pencere,
hasta bilgisi yazılmaması için uyarır.

Akış: uygulama → `worker/` altındaki Cloudflare Worker (`hilus-report`,
`https://hilus-report.hey-d80.workers.dev/report`) → GitHub REST API. GitHub token'ı yalnızca
Worker'ın gizlisinde durur (public uygulamaya token gömülmez). IP başına dakikada en fazla 3
bildirim kabul edilir; istek gövdesi kaydedilmez.

**Token kurulumu (bir kez):**

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
   → Generate new token: *Repository access* yalnızca `sametcodes/hilus`; *Permissions* →
   **Issues: Read and write** (başka izin gerekmez). Süresini uzun tutun (ör. 1 yıl).
2. Worker'a gizli olarak ekleyin:

   ```bash
   cd worker && npx wrangler secret put GITHUB_TOKEN
   ```

Token süresi dolarsa bildirimler “GitHub isteği başarısız (401)” hatası verir; aynı adımlarla
yenileyin. Worker kodu değişirse: `cd worker && npm install && npm run deploy`.

## Gizlilik

- Ses, parçalar, rapor ve geçmiş **asla diske yazılmaz**; yalnızca uygulama belleğinde yaşar.
  Ses örnekleri çözümleme biter bitmez bırakılır.
- Diske yazılan tek şey ayarlardır (`settings.json`, uygulama yapılandırma klasöründe:
  macOS `~/Library/Application Support/com.hilus.dikte/`, Windows `%APPDATA%\com.hilus.dikte\`).
- **API anahtarı bu ayar dosyasında düz metin olarak durur.** Ortak kullanılan bilgisayarda bunu
  göz önünde bulundurun.
- Dışarı giden tek veri “İşle”ye basıldığında seçili LLM sağlayıcısına giden prompt'tur
  (şablonlar + işaretli dikte metni). Bunun dışında Ayarlar'da model listesi için sağlayıcıya,
  güncelleme denetimi için GitHub'a (yalnızca `latest.json`) ve doktor “Sorun bildir”i
  kullanırsa yazdığı açıklama ile teknik bilgi Worker'a gider.

## Whisper modeli

Model: `whisper-large-v3-turbo-Q8_0.gguf` (~850 MB). Sırasıyla aranır:

1. Handy'nin Hugging Face önbelleği:
   `~/.cache/huggingface/hub/models--handy-computer--whisper-large-v3-turbo-gguf/snapshots/*/whisper-large-v3-turbo-Q8_0.gguf`
   (Windows: `%USERPROFILE%\.cache\huggingface\hub\...`; `HF_HUB_CACHE` / `HF_HOME` tanımlıysa
   önce onlara bakılır)
2. Hilus'un kendi indirdiği kopya: uygulama veri klasöründe `models/`.

Bulunamazsa üst çubukta “Modeli indir” düğmesi çıkar; dosya Hugging Face'ten
(`handy-computer/whisper-large-v3-turbo-gguf`) ilerleme çubuğuyla indirilir. Dil sabit Türkçe.
Ayarlardaki **başlangıç bağlamı** (initial prompt) Whisper'a talimat olarak değil, “daha önce
söylenmiş metin” olarak verilir; örnek rapor cümleleri ve sık terimler yazın. Whisper'ın bağlam
bütçesi ~223 token'dır; aşılırsa metnin yalnızca sonu kullanılır (transcribe.cpp davranışı).
Bu bağlam transcribe.cpp'nin genel `RunOptions::prompt` alanıyla iletilir (Whisper için
initial prompt'un karşılığı; ayrı `.bin` model veya whisper-rs gerekmedi).

## LLM sağlayıcıları

Ayarlar → Yapay zekâ: önce sağlayıcı, sonra API anahtarı, sonra model. Anahtar girilince
sağlayıcının model listesi çekilir (Anthropic `GET /v1/models`, Gemini ve OpenAI-uyumlu
`GET {adres}/models`) ve aranabilir listede gösterilir; liste alınamazsa model adı elle yazılır.

| Sağlayıcı | Uç | Varsayılan model |
|---|---|---|
| Anthropic (varsayılan) | `https://api.anthropic.com/v1/messages` | `claude-haiku-5-5` (Sonnet 5.5 seçilebilir) |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemini-3.6-flash` |
| OpenAI-uyumlu | `{temel adres}/chat/completions` | (elle girilir) |

Sonnet 5.5 seçiliyse istek, güvenlik sınıflandırıcısı reddederse sunucu tarafında yedek modele
düşen `fallbacks: "default"` ile gönderilir.

## Prompt ve şablonlar

Prompt, ayarlardaki parçalardan birleştirilir (Ayarlar → Prompt önizleme'de tamamı görülür):

- **Şablonlar** — her biri: ad, anahtar sözler, şablon metni, kısaltmalar. Listedeki sıra
  önceliktir (Otomatik modda dikte başındaki sözler yukarıdan aşağıya ilk eşleşen şablonu
  seçer). Şablon eklenebilir, silinebilir, sürükle-bırakla sıralanabilir.
- **Yazım sözlüğü** — “duyulan → doğru yazım” satırları.
- **Genel talimatlar** — giriş, mod seçimi, şablon modu kuralları, genel kurallar, çıktı kuralı.

Başlangıç değerleri `docs/handy-radyoloji-prompt.txt`'ten üretilir:

```bash
npm run gen-defaults
```

(`src-tauri/defaults/prompt-defaults.json`'u yeniden yazar; uygulamaya derlemede gömülür.
Ayarlar → Genel talimatlar → “Tümünü başlangıç değerlerine döndür” bu değerlere döner.)
Birleşik prompt orijinal dosyayla aynı satırları içerir; tek fark, şablon blokları ve kısaltma
bölümlerinin öncelik sırasına göre dizilmesidir.

## Otomatik güncelleme (GitHub Releases)

Kurulu uygulama açılışta (Ayarlar → Uygulama'dan kapatılabilir) ve tepsi menüsünden
`https://github.com/sametcodes/hilus/releases/latest/download/latest.json` adresine bakar.
Yeni sürüm varsa üst çubukta “Yeni sürüm x.y.z · Güncelle” çıkar; Güncelle indirir, imzayı
doğrular, kurar ve yeniden başlatır (açık dikte varsa önce onay ister, çünkü bellek silinir).
Repo adı farklıysa `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` değiştirilmeli.

**İmza anahtarı:** güncellemeler minisign ile imzalanır. Anahtar çifti bu Mac'te üretildi:

- `~/.tauri/hilus-updater.key` (gizli anahtar) ve `~/.tauri/hilus-updater.password` (parolası)
- açık anahtar `tauri.conf.json` içinde.

Gizli anahtar kaybolursa kurulu uygulamalar yeni sürümleri kabul etmez (elle yeniden kurulum
gerekir); yedekleyin, repoya koymayın.

**İlk kurulum (bir kez):** GitHub repo → Settings → Secrets and variables → Actions:

| Gizli | Değer |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `~/.tauri/hilus-updater.key` dosyasının içeriği |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `~/.tauri/hilus-updater.password` dosyasının içeriği |

**Yeni sürüm yayımlama:**

```bash
npm run bump -- 0.2.0
git commit -am "chore: v0.2.0" && git tag v0.2.0 && git push --follow-tags
```

`.github/workflows/release.yml` etiketi görünce macOS (Apple Silicon `.dmg`) ve Windows
(`.exe` NSIS, `.msi`) paketlerini derler, Release'i oluşturur ve imzalı `latest.json`'u ekler.
Kurulu uygulamalar bu sürümü kendileri bulur. (Intel Mac paketi üretilmiyor.)

## Kurulum ve derleme

Gerekenler: Rust (stable, ≥ 1.85), Node.js ≥ 20, **CMake** (transcribe.cpp kaynaktan derlenir).

```bash
npm install
npm run tauri dev
```

Dağıtım paketi (güncelleme dosyaları imzalandığı için anahtar ortamda olmalı):

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/hilus-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat ~/.tauri/hilus-updater.password)"
npm run tauri build
```

### macOS

- Xcode Command Line Tools + `brew install cmake`.
- Whisper Metal (GPU) ile çalışır.
- İlk kayıtta mikrofon izni istenir (`Info.plist` → `NSMicrophoneUsageDescription`,
  `Entitlements.plist` → `com.apple.security.device.audio-input`). `tauri dev` ile çalışırken
  izin, uygulamayı başlatan terminale sorulur.
- Paket ad-hoc imzalıdır (`signingIdentity: "-"`); başka bir Mac'te ilk açılışta Gatekeeper
  uyarısı çıkar (sağ tık → Aç).

### Windows

- Visual Studio 2022 Build Tools (“Desktop development with C++”), CMake, Rust (MSVC), Node.js.
- WebView2 kurulu değilse yükleyici indirir (`webviewInstallMode: downloadBootstrapper`).
- Whisper varsayılan olarak **CPU** ile çalışır (ek SDK gerektirmez). GPU için Vulkan SDK
  kurup `npm run tauri build -- --features vulkan` deneyin.
- Çıktı: `src-tauri/target/release/bundle/nsis/*.exe` ve `msi/*.msi`.
- Pano: `Rich Text Format` (RTF), `HTML Format` (CF_HTML başlıklı) ve `CF_UNICODETEXT` birlikte
  yazılır; mantık `docs/handy-kalin.ahk` ile aynıdır.

Windows paketi bir Windows makinesine ihtiyaç duymadan GitHub Actions'ta üretilir (yukarıdaki
sürüm iş akışı; Actions → release → Run workflow ile elle de tetiklenebilir).

## Doğrulananlar (macOS, 16 Ekim 2026)

- `.app` paketi derleniyor; mikrofon izni ve `audio-input` yetkisi pakette.
- Handy'nin indirdiği model bulunuyor ve Metal'de yükleniyor; Türkçe sentetik bir dikte
  (~9 sn) ~1,5 sn'de çözümlendi. Başlangıç bağlamı çıktıyı belirgin biçimde düzeltti
  (“alt pol” → “alt polde”, büyük harf düzeni). Test: `whisper::tests::whisper_smoke`
  (`HILUS_TEST_WAV=… cargo test --release -- --ignored whisper_smoke --nocapture`).
- Uygulamada Space ile gerçek mikrofondan kayıt → parça akışı çalışıyor.
- Tepsi: pencere kapatılınca süreç yaşıyor, tepsi simgesine tıklayınca pencere geri geliyor.
- Güncelleme dosyaları (`Hilus.app.tar.gz` + `.sig`) yerel derlemede imzalı üretiliyor.
- RTF/HTML üretimi birim testli; üretilen RTF macOS `textutil` ile kalın ve Türkçe karakterler
  doğru olarak okunuyor.
- Windows pano kodu Windows hedefi için tip kontrolünden geçti (`cargo check --target
  x86_64-pc-windows-msvc`, yalnızca pano modülü).

## Doğrulanmamış noktalar

- **Windows'ta hiç derlenmedi ve test edilmedi** (transcribe.cpp'nin MSVC/CMake derlemesi,
  CPU arka ucu, NSIS/MSI paketleme, panonun rapor programındaki davranışı).
- Sürüm iş akışı (`release.yml`) hiç çalıştırılmadı; güncellemenin gerçek bir Release'ten
  indirilip kurulması denenmedi.
- Model listesi çekme gerçek anahtarla denenmedi; Gemini'nin OpenAI-uyumlu `/models` yanıt
  biçimi varsayıldı.
- Windows'ta tepsi, tek kopya ve özel açılır listeler denenmedi.
- “İşle” gerçek bir LLM anahtarıyla denenmedi (geliştirme sırasında anahtar yoktu); “Kopyala”nın
  panoya yazması uygulama içinden uçtan uca denenmedi.
- Windows'ta CPU üzerinde large-v3-turbo hızı ölçülmedi; parça başına birkaç saniye sürebilir.
- RTF çıktısının hastanenin rapor programında kalın göründüğü yalnızca AHK betiğindeki aynı
  biçime dayanarak varsayıldı; o programda denenmedi.
- Handy'nin 12 Ekim'de indirdiği model dosyası Hugging Face'teki güncel dosyadan 32 bayt farklı;
  indirmede hash yerine boyut kontrolü yapılıyor.
- Gemini model adı (`gemini-3.6-flash`) yalnızca üçüncü taraf kaynaklarla doğrulandı.
- Mikrofon, 16 kHz'e basit (kutu filtresi + doğrusal) yeniden örneklemeyle dönüştürülüyor;
  kaliteye etkisi ölçülmedi.

## Dosya düzeni

```
docs/                     prompt kaynağı ve AHK pano referansı
scripts/gen-defaults.mjs  prompt → başlangıç ayarları
src/                      arayüz (TypeScript, Vite)
src-tauri/src/
  audio.rs                mikrofon kaydı (cpal), yalnızca bellek
  whisper.rs              model bulma/indirme/yükleme, çözümleme (transcribe-cpp)
  llm.rs                  Anthropic / OpenAI-uyumlu istek
  rich.rs                 **…** → RTF / HTML / düz metin
  clipboard.rs            panoya çoklu biçim (macOS NSPasteboard, Windows clipboard-win)
  settings.rs             ayarlar (diske yazılan tek veri)
  tray.rs                 sistem tepsisi, kapat = gizle
src/select.ts             native <select> yerine özel açılır liste / birleşik kutu
src/drag-sort.ts          işaretçi olaylarıyla sürükle-bırak sıralama
src/updater.ts            GitHub Releases güncelleme denetimi ve kurulumu
.github/workflows/        release.yml — etiketle sürüm yayımlama
worker/                   “Sorun bildir” Cloudflare Worker'ı (GitHub issue açar)
```
