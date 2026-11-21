# chatbrowser

English | [简体中文](README.zh-CN.md)

A local chat history browser forked from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo). Instead of talking to the DeepSeek API, it loads the official **chat history export** (`deepseek_data-*.zip`) and renders conversations with the original UI — fully offline, no API key.

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

## Features

- Import one or more history export ZIPs; each becomes an archive group, and imports are additive — existing data is never replaced.
- Browse conversations with the original rendering: Markdown, syntax highlighting, KaTeX math, Mermaid diagrams, deep-thinking timelines, web-search steps and source citations, message branches with version switching, and image attachments (non-image attachments show metadata only).
- Archive groups behave like browser tab groups: rename, color, collapse, move chats between groups, merge, dissolve, export a group back to a ZIP, or delete it. All organization is local; your source ZIP files are never touched.
- Global text search across titles, questions and answers with highlighted snippets and in-chat jump. Normalized matching (case, width, whitespace) with a fuzzy subsequence fallback.
- Read replies aloud with the browser's built-in speech synthesis — no TTS endpoint required.
- Simplified Chinese and English, light and dark themes, and mobile layouts.

## Data and storage

Imported conversations, group metadata and original images are stored in the browser's IndexedDB; preferences (language, theme, sidebar) stay in localStorage. Everything is local: the app makes no network requests except for search-result links you open yourself. Removing all data is available in Settings → Data.

Exports produced by the group export and "export all" follow the original archive format, so they can be re-imported here or into the official client.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

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

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
