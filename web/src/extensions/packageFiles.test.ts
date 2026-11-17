import { describe, expect, it } from 'vitest';
import { extensionFiles, extensionFolderError } from './packageFiles';

function file(path: string, content = 'ok') {
  const result = new File([content], path.split('/').at(-1)!);
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}

describe('portable extension folder selection', () => {
  it('keeps the packaged entry and assets while excluding machine-specific files', () => {
    const selected = extensionFiles([
      file('sample/mio-extension.json'),
      file('sample/core/main.py'),
      file('sample/page/dist/index.html'),
      file('sample/.env'),
      file('sample/.env.local'),
      file('sample/page/node_modules/lib/index.js'),
      file('sample/__pycache__/main.pyc'),
      file('sample/.git/config'),
    ]);
    expect(selected.map((entry) => entry.webkitRelativePath)).toEqual([
      'sample/mio-extension.json',
      'sample/core/main.py',
      'sample/page/dist/index.html',
    ]);
    expect(extensionFolderError(selected)).toBeNull();
  });
  it('rejects a parent folder and oversize uploads before sending them', () => {
    expect(extensionFolderError([file('extensions/sample/mio-extension.json')])).toBe(
      'folderManifest',
    );
    const huge = file('sample/page/dist/index.js');
    Object.defineProperty(huge, 'size', { value: 51 * 1024 * 1024 });
    expect(extensionFolderError([file('sample/mio-extension.json'), huge])).toBe('packageTooLarge');
  });
});
