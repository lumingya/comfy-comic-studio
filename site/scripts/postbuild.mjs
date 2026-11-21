import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultDist = fileURLToPath(new URL('../dist/', import.meta.url));
const generatedStart = '<!-- mio:public-urls:start -->';
const generatedEnd = '<!-- mio:public-urls:end -->';

export function normalizeBasePath(value = '/') {
  const base = value.trim() || '/';
  if (!base.startsWith('/') || base.startsWith('//') || /[\\?#\s]/u.test(base)) {
    throw new Error('VITE_BASE_PATH must be an absolute URL path, for example / or /mio/.');
  }
  const segments = base.split('/').filter(Boolean);
  if (segments.some((segment) => ['.', '..'].includes(decodeURIComponent(segment)))) {
    throw new Error('VITE_BASE_PATH cannot contain dot segments.');
  }
  return segments.length ? `/${segments.join('/')}/` : '/';
}

function rejectLocalUrl(url) {
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    host === '0.0.0.0' ||
    host.startsWith('127.')
  ) {
    throw new Error(`Public metadata cannot point to a local server: ${url.href}`);
  }
}

export function normalizeSiteUrl(value, basePath = '/') {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  rejectLocalUrl(url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('VITE_SITE_URL must be a public HTTP(S) URL without credentials.');
  }
  if (url.search || url.hash) throw new Error('VITE_SITE_URL cannot contain a query or fragment.');
  if (url.pathname === '/') url.pathname = basePath;
  if (normalizeBasePath(url.pathname) !== basePath) {
    throw new Error('VITE_SITE_URL must use the same path as VITE_BASE_PATH.');
  }
  url.pathname = basePath;
  return url.href;
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>');
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gu)].map(
      ([, name, doubleQuoted, singleQuoted, unquoted]) => [
        name.toLowerCase(),
        decodeHtml(doubleQuoted ?? singleQuoted ?? unquoted),
      ],
    ),
  );
}

function imageReference(html) {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attrs = attributes(tag);
    if (attrs.property === 'og:image' && attrs.content) return attrs.content;
  }
  return 'og-image.png';
}

function toSitePath(reference, basePath, siteUrl) {
  if (/^https?:\/\//iu.test(reference)) {
    const url = new URL(reference);
    rejectLocalUrl(url);
    return url.href;
  }
  const relative = reference.startsWith(basePath)
    ? reference.slice(basePath.length)
    : reference.replace(/^\/+/, '');
  return siteUrl ? new URL(relative, siteUrl).href : `${basePath}${relative}`;
}

function renderPublicMetadata(html, basePath, siteUrl) {
  const image = toSitePath(imageReference(html), basePath, siteUrl);
  const withoutGenerated = html.replace(
    new RegExp(`${generatedStart}[\\s\\S]*?${generatedEnd}\\s*`, 'gu'),
    '',
  );
  const clean = withoutGenerated.replace(/<(?:link|meta)\b[^>]*>\s*/giu, (tag) => {
    const attrs = attributes(tag);
    return attrs.rel?.split(/\s+/u).includes('canonical') ||
      ['og:url', 'og:image'].includes(attrs.property) ||
      attrs.name === 'twitter:image'
      ? ''
      : tag;
  });
  const metadata = [generatedStart];
  if (siteUrl) {
    metadata.push(`    <link rel="canonical" href="${escapeHtml(siteUrl)}" />`);
    metadata.push(`    <meta property="og:url" content="${escapeHtml(siteUrl)}" />`);
  }
  metadata.push(`    <meta property="og:image" content="${escapeHtml(image)}" />`);
  metadata.push(`    <meta name="twitter:image" content="${escapeHtml(image)}" />`);
  metadata.push(`    ${generatedEnd}`);
  if (!/<\/head>/iu.test(clean)) throw new Error('dist/index.html has no closing head tag.');
  return clean.replace(/\s*<\/head>/iu, `\n    ${metadata.join('\n')}\n  </head>`);
}

async function listFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Build artifacts cannot contain links: ${relative}`);
    if (entry.isDirectory()) files.push(...(await listFiles(directory, relative)));
    else files.push(relative);
  }
  return files;
}

async function verifyReference(reference, source, options) {
  const { distDir, basePath, siteUrl } = options;
  if (!reference || /^(?:#|data:|blob:|mailto:|tel:)/iu.test(reference)) return;
  const origin = siteUrl ? new URL(siteUrl).origin : 'https://mio-build.invalid';
  const url = new URL(decodeHtml(reference), `${origin}${basePath}${source}`);
  rejectLocalUrl(url);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported resource URL in ${source}: ${reference}`);
  }
  if (url.origin !== origin) return;
  if (!url.pathname.startsWith(basePath)) {
    throw new Error(`Resource escapes VITE_BASE_PATH (${basePath}) in ${source}: ${reference}`);
  }
  let relative = decodeURIComponent(url.pathname.slice(basePath.length));
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const target = path.resolve(distDir, relative);
  const fromDist = path.relative(distDir, target);
  if (fromDist.startsWith('..') || path.isAbsolute(fromDist)) {
    throw new Error(`Resource escapes dist in ${source}: ${reference}`);
  }
  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    throw new Error(`Missing local resource in ${source}: ${reference}`);
  }
  if (!targetStat.isFile()) throw new Error(`Resource is not a file in ${source}: ${reference}`);
}

function htmlReferences(html) {
  const references = [];
  for (const [tag] of html.matchAll(/<(?:script|link|img|source|video|audio|image|a)\b[^>]*>/giu)) {
    const attrs = attributes(tag);
    if (attrs.src) references.push(attrs.src);
    if (attrs.poster) references.push(attrs.poster);
    if (attrs.href && !attrs.rel?.split(/\s+/u).includes('canonical')) references.push(attrs.href);
    if (attrs['xlink:href']) references.push(attrs['xlink:href']);
    if (attrs.srcset && !attrs.srcset.startsWith('data:')) {
      references.push(...attrs.srcset.split(',').map((entry) => entry.trim().split(/\s+/u)[0]));
    }
  }
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/giu)) {
    const attrs = attributes(tag);
    if (['og:image', 'og:url'].includes(attrs.property) || attrs.name === 'twitter:image') {
      references.push(attrs.content);
    }
  }
  return references;
}

export async function verifyBuild(options) {
  const { distDir } = options;
  let referenceCount = 0;
  for (const file of await listFiles(distDir)) {
    if (!/\.(?:html|css)$/u.test(file)) continue;
    const contents = await readFile(path.join(distDir, file), 'utf8');
    const references = file.endsWith('.html')
      ? htmlReferences(contents)
      : [...contents.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/giu)].map((match) =>
          match[1].trim(),
        );
    for (const reference of references) {
      await verifyReference(reference, file, options);
      referenceCount += 1;
    }
  }
  return referenceCount;
}

export async function prepareBuild({
  distDir = defaultDist,
  basePath = process.env.VITE_BASE_PATH,
  siteUrl = process.env.VITE_SITE_URL,
  check = false,
} = {}) {
  basePath = normalizeBasePath(basePath);
  siteUrl = normalizeSiteUrl(siteUrl, basePath);
  const indexPath = path.join(distDir, 'index.html');
  const html = await readFile(indexPath, 'utf8');
  const rendered = renderPublicMetadata(html, basePath, siteUrl);
  const artifacts = new Map([
    ['index.html', rendered],
    [
      'robots.txt',
      `User-agent: *\nAllow: /\n${siteUrl ? `\nSitemap: ${siteUrl}sitemap.xml\n` : ''}`,
    ],
    ['.nojekyll', ''],
  ]);
  if (siteUrl) {
    artifacts.set(
      'sitemap.xml',
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${escapeHtml(siteUrl)}</loc></url>\n</urlset>\n`,
    );
  }
  for (const [file, expected] of artifacts) {
    if (check) {
      const actual = await readFile(path.join(distDir, file), 'utf8');
      if (actual !== expected) throw new Error(`Build metadata is stale: ${file}`);
    } else {
      await writeFile(path.join(distDir, file), expected, 'utf8');
    }
  }
  if (!siteUrl) {
    try {
      await stat(path.join(distDir, 'sitemap.xml'));
      throw new Error('A sitemap exists without VITE_SITE_URL; rebuild with a public site URL.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const references = await verifyBuild({ distDir, basePath, siteUrl });
  return { basePath, siteUrl: siteUrl ?? null, references };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.slice(2).some((argument) => argument !== '--check')) {
      throw new Error('Usage: node scripts/postbuild.mjs [--check]');
    }
    const result = await prepareBuild({ check: process.argv.includes('--check') });
    console.log(`Site build verified: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(`Site build check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
