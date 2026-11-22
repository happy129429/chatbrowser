# chatbrowser

English | [简体中文](README.zh-CN.md)

A **local AI chat history browser** forked from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). It never calls an API: load exported files (DeepSeek ZIP; ChatGPT / Claude / z.ai ZIP or JSON) and browse them entirely offline.

> **Credits**: built by **GLM-5.3-Flash (Z.ai)** and **DeepSeek-V4.1-Flash-1017**; the human participant contributed the original idea and feedback. The UI and message rendering pipeline come largely from the upstream [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo).

## Use online (GitHub Pages)

Open **https://happy129429.github.io/chatbrowser/** — nothing to install.

- Data lives in the current browser's IndexedDB, scoped to that site
- It is **separate** from the desktop and Android builds
- The Pages site is redeployed automatically on every push to main (the release flow pushes main first)
- There is no "Quit app" section in the browser build; just close the tab

## Screenshots

| Archive list                               | Global search                                 |
| ------------------------------------------ | --------------------------------------------- |
| ![Archive list](docs/screenshots/list.png) | ![Global search](docs/screenshots/search.png) |

| Round navigation                                    | Statistics                                |
| --------------------------------------------------- | ----------------------------------------- |
| ![Round navigation](docs/screenshots/round-nav.png) | ![Statistics](docs/screenshots/stats.png) |

## Three ways to use it

| Option  | Best for               | How to start                                                             |
| ------- | ---------------------- | ------------------------------------------------------------------------ |
| Web     | No install, quick look | Open https://happy129429.github.io/chatbrowser/                          |
| Desktop | Long-term, stable data | Download `windows-x64.zip` / `linux-x64.tar.gz` from Releases and launch |
| Android | Phone                  | Install `chatbrowser-android.apk` from Releases                          |

### Desktop (Windows / Linux)

- Windows: extract `windows-x64.zip` and double-click `chatbrowser.exe`; it opens a chromeless Edge/Chrome window
- No exe: `windows-portable.zip` → double-click `start-chatbrowser.cmd` (served by PowerShell, avoids unsigned-exe blocking)
- Linux: extract `linux-x64.tar.gz`, run `./chatbrowser`; install `chatbrowser.desktop` for the app menu
- The local server is fixed at `http://127.0.0.1:17890`, so data persists across launches
- Closing the window keeps the launcher running; use Settings → Quit app to stop it and release the executable

### Android

- Install the debug-signed APK (Android 6+), then import ZIP/JSON files
- Exports are written to the system **Documents** folder (WebView cannot download blob URLs)

## Import formats

- DeepSeek export `deepseek_data-*.zip` (full pipeline: branches, tool steps, images, reasoning)
- ChatGPT export (`conversations.json` ZIP with the `mapping` tree)
- Claude export (`conversations.json` ZIP with `chat_messages` / `content` arrays; thinking blocks are separated from the answer, files keep metadata only)
- z.ai / OpenWebUI native exports (`chat.history.messages` object tree + `currentId`, imports the active branch)
- Single-session `turn_history` envelopes (`session_metadata` / `global_context` system instructions)
- z.ai and similar formats (`messages` / `chat_history` etc.)
- Import multiple files at once; each import becomes an archive group with incremental merges
- System prompts are preserved for external chats; account-level memories/instructions from the group menu

## Features

- Full rendering: Markdown, code highlighting, KaTeX, Mermaid, reasoning timeline, web search sources, message branches and attachments
- Safety-refused replies show only the notice by default; in the archive you can use "Show original content" to reveal the reasoning and text that were sent
- Archive groups: rename, color, collapse, move sessions, merge, dissolve, export as ZIP, delete
- Global search with highlighted excerpts and jump-to-message; cached index per data version
- Export as…: groups or single conversations to DeepSeek-compatible ZIP, DeepSeek extended ZIP (system prompts and group info kept in a sidecar), or Claude JSON; includes an option to anonymize IDs
- Round-level export: self-contained HTML (MathML, Prism, sources) or Markdown
- Round navigation, scroll restoration, session restore, read-aloud, token/round statistics
- Chinese/English UI (follows the browser by default), light/dark themes, mobile layout

## Data and storage

- Sessions, groups and attachments live in IndexedDB; locale, theme and scroll positions in localStorage
- No network requests except links you click and the update check (GitHub API)
- Storage is isolated per origin:

| Entry point      | Origin                          |
| ---------------- | ------------------------------- |
| Web app          | `https://happy129429.github.io` |
| Desktop launcher | `http://127.0.0.1:17890`        |
| Dev server       | `http://localhost:8090`         |
| Android          | `https://localhost`             |

## Known issues

- The desktop launchers are unsigned: SmartScreen/Defender may warn; use the portable build or unblock the ZIP before extracting
- The launcher uses a fixed port; a newer build closes a stale older instance, the portable build asks you to close it first
- No sync or built-in backup between entries/browsers — export a group ZIP before switching
- Vendor export formats may change; attach a sanitized sample when reporting import issues
- z.ai's "export archived conversation" may only include the first user prompt; the remaining message bodies are missing from the export itself

## Development

```sh
pnpm install
pnpm dev          # http://localhost:8090
pnpm build        # static site → dist/
pnpm type && pnpm lint && pnpm e2e
```

| Command            | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `pnpm mock`        | Generate mock archives and external samples        |
| `pnpm e2e`         | Headless smoke tests (Chrome required)             |
| `pnpm shots`       | Regenerate README screenshots (dev server on 8090) |
| `pnpm icons`       | Generate platform icons from `assets/icon.svg`     |
| `pnpm desktop`     | Build Windows/Linux launchers → `release/desktop`  |
| `pnpm android:apk` | Build the debug APK                                |

See [docs/release-checklist.md](docs/release-checklist.md) for the release process; the archived native-shell proposal lives in [docs/technical-outlook.md](docs/technical-outlook.md).

## License

Released under [GPL-3.0-or-later](LICENSE). The upstream [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) is MIT-licensed; its notice is preserved in [LICENSE](LICENSE). Third-party dependencies keep their own licenses.
