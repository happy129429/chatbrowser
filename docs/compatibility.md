# Compatibility policy

This project is an unofficial local archive browser. It reads chat exports that
users choose to open, normalizes them for reading, and can export converted
copies. Nothing is uploaded by the importer.

## Implementation boundary

- Parsers are independent implementations based on user-provided export data,
  public format information and observed behavior.
- Vendor application code, bundled assets, CSS and UI text are not copied into
  this project.
- Field names, JSON paths, timestamps and other functional facts may be used
  for interoperability. Human-readable explanations are written by this
  project, not copied from a vendor.
- The project does not use private APIs, scrape live services or bypass access
  controls.

## Data boundary

- Imports and exports happen locally in the browser or app sandbox.
- Only import data you have the right to process. Importing another person's
  conversations may involve their privacy; confirm permission first.
- Tests use synthetic or sanitized fixtures. Real exports, attachments and
  account identifiers should not be committed to the repository.
- Account-level personal files are skipped where the importer can identify
  them; archive notes are shown only for content the product needs.

## Trademarks and affiliation

DeepSeek, ChatGPT/OpenAI, Claude/Anthropic, z.ai and other names belong to their
respective owners. This project is not affiliated with, sponsored by or endorsed
by those companies. Compatibility descriptions are descriptive only.

## Open-source compliance

- This project is distributed under GPL-3.0-or-later. The upstream MIT notice
  for deepseek-ai/chat-demo is preserved in `LICENSE`.
- Third-party packages remain under their own licenses. The build generates
  `THIRD_PARTY_NOTICES.txt` from production dependencies and includes it in the
  web build, desktop packages and Android build; the app also exposes it from
  the About page.
- Do not add dependencies with unknown or incompatible licenses, or vendor
  proprietary code, without reviewing the resulting distribution.
- Keep `LICENSE` and the generated third-party notices with every distributed
  build. The corresponding source is available in this repository.
- Contributed assets, fonts, icons and documentation must have a license
  compatible with this project.

## Contributions

Do not submit vendor application code, copied UI text or assets, or real user
exports. Compatibility samples must be synthetic or sanitized before they enter
the repository. Contributors are responsible for checking the license of any
new dependency or asset.
