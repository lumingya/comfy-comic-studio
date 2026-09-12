/*
Mio frontend source
===================
Run npm ci, then npm run build. Default publication is external scripts/CSS,
not an inline application. index.html is generated from js/shell.js.
See docs/DEVELOPMENT.md for the feature module map and tests.
js/source-manifest.js records script order. Feature files declare functions;
shared UI state follows them; app.js installs the runtime last.
Use node js/build.js check for syntax. Explicit bundle is diagnostic only;
run npm run build afterwards to restore the ordinary external release.
Do not re-extract an old bundle over maintained source files.
This split preserves script initialization order; it is not lazy loading.
*/
