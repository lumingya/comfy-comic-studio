/*
ComfyComic development source migration
======================================

The current index.html is the complete, runnable standalone delivery. The six
modules contain the native contract fixes. The build tool can extract EVERY
legacy declaration and ALL CSS from the preserved delivery without rewriting
the galleries, reader, exporters, assistant, GitHub tools, or node UI.

Run once with Node 18+:
  npm install --no-save --package-lock=false acorn@8.15.0
  node js/build.js extract

Then edit:
  styles.css
  js/state.js
  js/sync.js
  js/engine.js
  js/creation.js
  js/ui.js
  js/app.js

Validation:
  node js/tests.js
  node js/build.js check

Development mode, using only server-allowed public paths:
  node js/build.js dev

Standalone delivery:
  node js/build.js bundle

Do not run `extract` again after editing the source modules unless intentionally
regenerating them from the current bundled index.html. `extract` replaces the
module files. Commit or back up the development sources before regenerating.

Top-level application initialization stays ordered in app.js. Function
declarations are separated by responsibility. This intentionally preserves the
existing compatibility-adapter order; there is no eval in the application.

Backend contract:
  GET /api/config
  POST /api/config
  templates, savedGalleries, batchMatrix, comfyWorkflows, comfyConfig,
  llmConfig, xmlConfig, chatConfig, uiConfig, batchRunState
  updatedAt is also written; user-authorized removal adds forceWrite: true.

Unknown metadata in native containers is preserved. Studio-only projects,
variable sets, export templates and UI preferences are retained within uiConfig.

This environment has no Node or browser execution tool. The extraction, build,
tests, UI interaction and real Python/ComfyUI calls must be executed in the
development environment before claiming full regression verification.

Artwork-first presentation update
--------------------------------
state.js: createFreePromptPolicy provides declared-variable tokenization and
non-blocking interpolation. Unknown braces and NovelAI weights remain literal.
Punctuation cleanup is applied only after an explicitly declared empty value
has been removed, and skips quoted/bracketed content.

engine.js: installFreePromptEngine removes prompt syntax guards while retaining
typed workflow-input checks and upstream-link protection.

ui.js: createReaderPresentationModel separates gallery/spread/webtoon reading
from editing tools, and highlightedPromptHTML escapes user input safely.

The standalone index.html also includes the full presentation views, minimal
12-scene demo, optional laboratory, and layered textarea highlighting. The AST
extractor preserves these components when materializing development modules.
Previously saved remote data is never replaced by the minimal demonstration.

Collection display and localization
-----------------------------------
ui.js contains createCollectionDisplayModel (explicit showcase/grid mode,
pagination and proportional fitting), createReaderPresentationModel (scroll by
default), and createStudioLocaleCatalog (native Chinese/English labels).
state.js contains trimUntouchedDemoBook, which retains the cover and never
deletes edited or non-demo artwork.

The standalone delivery includes matching domain helpers and the complete
gallery, image-load handlers, preference controls and localization integration.
Interface language never changes authored prompts, captions or book titles.
Presentation preferences are included in the existing flat /api/config payload
inside uiConfig. Demo shrinkage is saved with the existing forceWrite mechanism.

Default character naming
------------------------
{character} is the model-facing character name / trigger used in image prompts.
{character_display_name} is the reader-facing name used in narration. Both are
ordinary independently editable text variables, with no new syntax restrictions.
New books use the display name for characterName metadata; workflow prompts and
queue snapshots retain the model-facing value. A missing display field preserves
legacy naming behavior, while an explicitly empty value remains empty.
Only recognized, unchanged built-in source templates/presets are upgraded.
Authored templates, generated books, and queued snapshots are not rewritten.
*/