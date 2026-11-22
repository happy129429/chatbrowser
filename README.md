# chatbrowser

English | [简体中文](README.zh-CN.md)

A local chat history browser forked from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). Instead of talking to the DeepSeek API, it loads the official **chat history export** (`deepseek_data-*.zip`) and renders conversations with the original UI — fully offline, no API key.

> **Credits**: This project was developed by **GLM-5.3-Flash (Z.ai)** and **DeepSeek-V4.1-Flash-1017**; the human contributors provided only the original idea and feedback. It stands on the shoulders of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) — many thanks for the excellent UI and rendering pipeline.

## Screenshots

| Archive list                               | Global search                                 |
| ------------------------------------------ | --------------------------------------------- |
| ![Archive list](docs/screenshots/list.png) | ![Global search](docs/screenshots/search.png) |

| Round navigation                                    | Statistics                                |
| --------------------------------------------------- | ----------------------------------------- |
| ![Round navigation](docs/screenshots/round-nav.png) | ![Statistics](docs/screenshots/stats.png) |

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/happy129429/chatbrowser.git
cd chatbrowser
pnpm install
pnpm dev
```

Open http://localhost:8090, then drag one or more exported ZIP files onto the welcome page (or use the "Open archives" button / Settings → Data). To build a static site:

```sh
pnpm build
```

The output is written to `dist/` and can be deployed to any static server.

## Downloads

Prebuilt packages are attached to [Releases](https://github.com/happy129429/chatbrowser/releases):

| Package                   | Platform      | How to use                                                                                                                                     |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `windows-x64.zip`         | Windows 10/11 | Unzip and double-click `chatbrowser.exe`. A chromeless app window opens (Edge/Chrome); the launcher serves the UI at `http://127.0.0.1:17890`. |
| `linux-x64.tar.gz`        | Linux x86_64  | Extract, run `./chatbrowser` (or install `chatbrowser.desktop` for a menu entry).                                                              |
| `chatbrowser-android.apk` | Android 6+    | Sideload the APK, open the app, import a ZIP.                                                                                                  |

Notes:

- **Data lives per origin.** The launcher uses the fixed address `127.0.0.1:17890`, so imports persist across restarts; the dev server (`localhost:8090`), `file://` pages and the Android app each keep their own storage. Keep using one entry point per device.
- The desktop launcher prefers Chromium-based browsers (Edge/Chrome/Chromium) for the `--app` window; Firefox falls back to a normal tab. IndexedDB is per browser, so don't switch browsers if you want the same data.
- On Android, exports are written to the **Documents** folder (system WebView cannot download blob links); on desktop/web they download normally.
- The attached APK is a debug-signed build for direct installation; see `pnpm android:apk` to roll your own.

### Building the packages

```sh
pnpm icons        # regenerate platform icons from assets/icon.svg (needs Chrome)
pnpm desktop      # Windows/Linux single-file launchers → release/desktop (needs Go)
pnpm android:apk  # debug APK → android/app/build/outputs/apk/debug (needs Android SDK + JDK 17)
```

## Features

- Import DeepSeek history ZIPs, or ChatGPT / Claude / z.ai exports (ZIP or JSON); each becomes an archive group, and imports are additive — existing data is never replaced. Imported external chats keep their system prompts (viewable per chat), and account-level memories / custom instructions are shown from the group menu.
- Browse conversations with the original rendering: Markdown, syntax highlighting, KaTeX math, Mermaid diagrams, deep-thinking timelines, web-search steps and source citations, message branches with version switching, and image attachments (non-image attachments show metadata only).
- Archive groups behave like browser tab groups: rename, color, collapse, move chats between groups, merge, dissolve, export a group back to a ZIP, or delete it. All organization is local; your source ZIP files are never touched.
- Global text search across titles, questions and answers with highlighted snippets and in-chat jump. Normalized matching (case, width, whitespace) with a fuzzy subsequence fallback.
- Export selected rounds of a chat as a self-contained HTML file (rendered markdown, MathML formulas, highlighted code, sources) or as Markdown.
- Read replies aloud with the browser's built-in speech synthesis — no TTS endpoint required.
- UI language (follow-browser by default, Simplified Chinese / English), light and dark themes, and mobile layouts.

## Data and storage

Imported conversations, group metadata and original images are stored in the browser's IndexedDB; preferences (language, theme, sidebar) stay in localStorage. Everything is local: the app makes no network requests except for search-result links you open yourself. Removing all data is available in Settings → Data.

Exports produced by the group export and "export all" follow the original archive format, so they can be re-imported here or into the official client.

## Known issues

- The desktop launchers are unsigned: Windows SmartScreen/Defender may warn on first run. Use the `windows-portable.zip` (PowerShell, no exe) or unblock the ZIP (Properties → Unblock) before extracting.
- The launcher uses a fixed port (`127.0.0.1:17890`). A newer build automatically closes a stale older instance; the portable PowerShell build asks you to close it first.
- Data is stored per origin: the launcher (`127.0.0.1:17890`), the dev server, `file://` pages and the Android app each keep separate storage.
- External-format import covers the common export shapes of ChatGPT / Claude / z.ai; vendor changes may require mapping updates — please attach a sanitized sample when reporting.

## Development

| Command       | Description                                      |
| ------------- | ------------------------------------------------ |
| `pnpm dev`    | Start the development server                     |
| `pnpm build`  | Build into `dist/`                               |
| `pnpm type`   | Run TypeScript type checks                       |
| `pnpm lint`   | Lint with oxlint                                 |
| `pnpm format` | Format with oxfmt                                |
| `pnpm mock`   | Generate `mock/mock-data.zip` (v3 export format) |
| `pnpm e2e`    | Headless end-to-end smoke test (needs Chrome)    |
| `pnpm shots`  | Regenerate README screenshots                    |

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Sider, session view, message rendering, search, settings
  i18n/                English and Chinese translations
  services/
    api/               Protocol types kept for rendering archived content blocks
    chat/              Conversations, archive groups, storage, search, history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Read-aloud on the Web Speech API
  utils/               Shared utilities
```

## License

This project is released under the [GPL-3.0-or-later](LICENSE). It is a fork of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), originally published under the MIT License by DeepSeek — the original MIT notice is preserved inside [LICENSE](LICENSE) as required by its terms. Third-party dependencies are subject to their own licenses.
