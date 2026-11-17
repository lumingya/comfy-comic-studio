const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '__pycache__', '.venv']);

/** Keep runtime dependencies that were bundled, not a developer's caches or local secrets. */
export function extensionFiles(files: File[]): File[] {
  return files.filter((file) => {
    const parts = file.webkitRelativePath.replaceAll('\\', '/').split('/');
    const name = parts.at(-1) ?? '';
    return (
      !parts.some((part) => SKIP_DIRECTORIES.has(part)) &&
      name !== '.env' &&
      !name.startsWith('.env.') &&
      !name.endsWith('.pyc')
    );
  });
}

export function extensionFolderError(files: File[]): 'folderManifest' | 'packageTooLarge' | null {
  if (
    !files.some((file) => {
      const parts = file.webkitRelativePath.split('/');
      return parts.length === 2 && parts[1] === 'mio-extension.json';
    })
  )
    return 'folderManifest';
  if (
    files.length > 2_000 ||
    files.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024
  )
    return 'packageTooLarge';
  return null;
}
