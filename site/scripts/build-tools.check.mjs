import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeBasePath, normalizeSiteUrl, prepareBuild } from './postbuild.mjs';
import { pagesConfig } from './pages-config.mjs';

async function fixture(
  run,
  { basePath = '/', extraHtml = '', css = '', ogImage = `${basePath}og-image.png` } = {},
) {
  const temporaryRoot = path.resolve(tmpdir());
  const distDir = await mkdtemp(path.join(temporaryRoot, 'mio-site-check-'));
  try {
    await mkdir(path.join(distDir, 'assets'));
    await writeFile(path.join(distDir, 'assets', 'app.js'), 'console.log("demo");');
    await writeFile(path.join(distDir, 'assets', 'app.css'), css);
    await writeFile(path.join(distDir, 'og-image.png'), 'test image');
    await writeFile(
      path.join(distDir, 'index.html'),
      `<!doctype html><html><head><title>Mio</title>
        <meta name="description" content="A local comic studio" />
        <meta property="og:image" content="${ogImage}" />
        <link href="${basePath}assets/app.css" rel="stylesheet" />
        <script type="module" src="${basePath}assets/app.js"></script>
        </head><body>${extraHtml}<div id="root"></div></body></html>`,
    );
    await run(distDir);
  } finally {
    const relative = path.relative(temporaryRoot, path.resolve(distDir));
    assert.ok(relative.startsWith('mio-site-check-') && !relative.includes(path.sep));
    await rm(distDir, { recursive: true, force: true });
  }
}

test('normalizes deployment paths and rejects unsafe or local public URLs', () => {
  assert.equal(normalizeBasePath(), '/');
  assert.equal(normalizeBasePath('/mio'), '/mio/');
  assert.equal(normalizeSiteUrl('https://example.com', '/mio/'), 'https://example.com/mio/');
  assert.throws(() => normalizeBasePath('//mio/'), /absolute URL path/u);
  assert.throws(() => normalizeBasePath('/../mio/'), /dot segments/u);
  assert.throws(() => normalizeBasePath('/%2e%2e/mio/'), /dot segments/u);
  assert.throws(() => normalizeSiteUrl('http://127.0.0.1:5173/'), /local server/u);
  assert.throws(() => normalizeSiteUrl('http://localhost/'), /local server/u);
  assert.throws(() => normalizeSiteUrl('http://[::1]/'), /local server/u);
  assert.throws(() => normalizeSiteUrl('https://example.com/other/', '/mio/'), /same path/u);
  assert.throws(() => normalizeSiteUrl('https://example.com/?preview=1'), /query or fragment/u);
});

test('Pages config handles project sites, account sites, and repository renames', () => {
  assert.deepEqual(pagesConfig('lumingya/comfy-comic-studio'), {
    basePath: '/comfy-comic-studio/',
    siteUrl: 'https://lumingya.github.io/comfy-comic-studio/',
  });
  assert.deepEqual(pagesConfig('Owner/owner.github.io'), {
    basePath: '/',
    siteUrl: 'https://owner.github.io/',
  });
  assert.equal(pagesConfig('owner/renamed-site').basePath, '/renamed-site/');
  assert.equal(
    pagesConfig('owner/mio', 'https://example.com/mio/').siteUrl,
    'https://example.com/mio/',
  );
  assert.throws(() => pagesConfig('invalid-repository'), /owner\/repository/u);
});

test('root builds generate valid public SEO artifacts and remain stable when checked', async () => {
  await fixture(async (distDir) => {
    const options = { distDir, basePath: '/', siteUrl: 'https://example.com/' };
    const result = await prepareBuild(options);
    assert.equal(result.siteUrl, 'https://example.com/');
    const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
    assert.match(html, /rel="canonical" href="https:\/\/example\.com\/"/u);
    assert.match(html, /property="og:image" content="https:\/\/example\.com\/og-image\.png"/u);
    assert.equal((html.match(/property="og:image"/gu) ?? []).length, 1);
    assert.match(await readFile(path.join(distDir, 'sitemap.xml'), 'utf8'), /<loc>https:/u);
    assert.match(await readFile(path.join(distDir, 'robots.txt'), 'utf8'), /Sitemap: https:/u);
    await prepareBuild({ ...options, check: true });
  });
});

test('project builds preserve the base in assets, canonical URL, social image, and sitemap', async () => {
  await fixture(
    async (distDir) => {
      const options = {
        distDir,
        basePath: '/comfy-comic-studio/',
        siteUrl: 'https://owner.github.io/comfy-comic-studio/',
      };
      await prepareBuild(options);
      await prepareBuild({ ...options, check: true });
      const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
      assert.match(
        html,
        /content="https:\/\/owner\.github\.io\/comfy-comic-studio\/og-image.png"/u,
      );
      assert.match(
        await readFile(path.join(distDir, 'sitemap.xml'), 'utf8'),
        /<loc>https:\/\/owner\.github\.io\/comfy-comic-studio\/<\/loc>/u,
      );
    },
    { basePath: '/comfy-comic-studio/' },
  );
});

test('local builds omit canonical and sitemap instead of inventing a public origin', async () => {
  await fixture(async (distDir) => {
    const options = { distDir, basePath: '/', siteUrl: '' };
    await prepareBuild(options);
    await prepareBuild({ ...options, check: true });
    const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
    assert.doesNotMatch(html, /canonical|og:url|localhost|127\.0\.0\.1/u);
    assert.match(html, /property="og:image" content="\/og-image.png"/u);
    await assert.rejects(readFile(path.join(distDir, 'sitemap.xml')), { code: 'ENOENT' });
  });
});

test('missing local resources and root-relative resources outside a project base fail', async () => {
  await fixture(
    async (distDir) => {
      await assert.rejects(
        prepareBuild({ distDir, basePath: '/', siteUrl: '' }),
        /Missing local resource/u,
      );
    },
    { extraHtml: '<img src="/missing.webp" alt="" />' },
  );
  await fixture(
    async (distDir) => {
      await assert.rejects(
        prepareBuild({ distDir, basePath: '/mio/', siteUrl: '' }),
        /escapes VITE_BASE_PATH/u,
      );
    },
    { basePath: '/mio/', extraHtml: '<img src="/og-image.png" alt="" />' },
  );
});

test('CSS assets are resolved relative to the stylesheet and checked for existence', async () => {
  await fixture(
    async (distDir) => {
      const options = { distDir, basePath: '/mio/', siteUrl: '' };
      await prepareBuild(options);
      await writeFile(
        path.join(distDir, 'assets', 'app.css'),
        'body{background:url(./missing.png)}',
      );
      await assert.rejects(prepareBuild({ ...options, check: true }), /Missing local resource/u);
    },
    { basePath: '/mio/', css: 'body{background:url(../og-image.png)}' },
  );
});

test('the check mode detects stale generated SEO files and local social URLs', async () => {
  await fixture(async (distDir) => {
    const options = { distDir, basePath: '/', siteUrl: 'https://example.com/' };
    await prepareBuild(options);
    await writeFile(path.join(distDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
    await assert.rejects(prepareBuild({ ...options, check: true }), /stale: robots.txt/u);
  });
  await fixture(
    async (distDir) => {
      await assert.rejects(prepareBuild({ distDir, basePath: '/', siteUrl: '' }), /local server/u);
    },
    { ogImage: 'http://127.0.0.1/og-image.png' },
  );
});
