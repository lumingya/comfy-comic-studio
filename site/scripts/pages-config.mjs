import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeBasePath, normalizeSiteUrl } from './postbuild.mjs';

export function pagesConfig(repository, siteUrl) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository ?? '')) {
    throw new Error('GITHUB_REPOSITORY must have the form owner/repository.');
  }
  const [owner, name] = repository.split('/');
  const basePath =
    name.toLowerCase() === `${owner.toLowerCase()}.github.io`
      ? '/'
      : normalizeBasePath(`/${name}/`);
  return {
    basePath,
    siteUrl: normalizeSiteUrl(
      siteUrl || `https://${owner.toLowerCase()}.github.io${basePath}`,
      basePath,
    ),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const config = pagesConfig(process.env.GITHUB_REPOSITORY, process.env.VITE_SITE_URL);
    if (!process.env.GITHUB_OUTPUT)
      throw new Error('GITHUB_OUTPUT is required in the Pages workflow.');
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `base_path=${config.basePath}\nsite_url=${config.siteUrl}\n`,
      'utf8',
    );
    console.log(`Pages target: ${config.siteUrl} (base ${config.basePath})`);
  } catch (error) {
    console.error(`Pages configuration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
