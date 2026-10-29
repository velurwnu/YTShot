<div align="center">

# YTShot

**English** | [Русский](#ytshot-ru)

</div>

---

## YTShot

A lightweight Safari extension for macOS that captures the current video frame in the stream's exact native resolution (`videoWidth × videoHeight`) into lossless PNG. Works flawlessly while paused or playing, supporting full 1080p, 1440p, 4K, and 8K streams.

---

### Features

- **Native Stream Resolution:** Draws the decoded video frame directly onto a canvas at original dimensions, unaffected by browser window size, Retina scaling, or layout CSS.
- **Frame-by-Frame Navigation:** Step backward or forward frame-by-frame directly from the toolbar popup to capture the exact split second you want.
- **Auto Frame Rate Detection:** Dynamically detects the video's actual framerate (e.g. 24 fps, 30 fps, 60 fps) on the first step, with a fallback to 1/30 s.
- **Save or Copy:** One-click save to `~/Downloads` or direct copy to clipboard.
- **Smart Filenames:** Automatically generates detailed filenames: `Video Title [01-23.456] 3840x2160.png` with millisecond precision.
- **Keyboard Shortcuts:**
  - `⌥⇧S` (Option+Shift+S) — Save lossless PNG to Downloads.
  - `⌥⇧C` (Option+Shift+C) — Copy lossless PNG to clipboard.
- **Zero Background Resource Footprint:** No background worker, no permanently injected page scripts. Code is injected on-demand only when activating the extension.

---

### Build and Installation

```bash
./build.sh
```

The build script compiles the project, codesigns the bundle, places it in `~/Applications/YTShot.app`, and registers the extension in Safari using `pluginkit` without needing the wrapper app to stay running.

**Code Signing:**
The build is signed with an Apple Development certificate (configured in the Xcode project), so you do not need to enable "Allow Unsigned Extensions". Free developer certificates require rebuilding periodically if they expire.

---

### Project Structure

- `Extension/`: WebExtension sources (Manifest V3, icons, popup, content scripts).
- `YTShot/`: Native Swift macOS container app and Xcode project (`YTShot.xcodeproj`).
- `build.sh`: Automated compilation and registration script.

---

<br>

<a name="ytshot-ru"></a>

<div align="center">

[English](#ytshot) | **Русский**

</div>

---

## YTShot [RU]

Расширение Safari: сохраняет текущий кадр видео в исходном разрешении потока (`videoWidth × videoHeight`) в PNG без потерь. Работает и на паузе.

Кнопка на панели Safari открывает окошко: «Кадр назад», «Кадр вперёд», «Снять кадр» (PNG в «Загрузки»), «Скопировать кадр».

В фоне расширение ничего не делает: нет фонового скрипта и скриптов на страницах, приложение не запускается. Код попадает на страницу только при открытии окошка. Частота кадров измеряется при первом шаге по ролику: видео на долю секунды проигрывается без звука и возвращается на место. Если измерить не удалось, шаг 1/30 с.

Код расширения лежит в `Extension/`, Xcode-обёртка в `YTShot/` (ссылается на файлы из `Extension/`). Новый файл в `Extension/` нужно добавить и в Xcode-проект (таргет «YTShot Extension» → Copy Bundle Resources), иначе он не попадёт в сборку.

## Сборка

```bash
./build.sh
```

Скрипт собирает приложение с подписью, ставит его в `~/Applications/YTShot.app` и регистрирует расширение в Safari, не запуская приложение.

Сборка подписывается сертификатом Apple Development (команда задана в проекте), поэтому «Разрешить неподписанные расширения» не нужно. Сертификат бесплатного аккаунта действует ограниченное время — если расширение перестанет загружаться, просто пересоберите.
