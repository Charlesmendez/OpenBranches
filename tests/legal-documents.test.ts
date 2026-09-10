import { describe, expect, it } from 'vitest';
import { legalDocumentCopyPath, legalDocumentPath } from '../electron/legal/documents';

describe('legal documents', () => {
  it('opens only fixed files from packaged application resources', () => {
    const environment = {
      packaged: true,
      resourcesPath: '/Applications/OpenBranches.app/Contents/Resources',
      appPath: '/ignored',
    };
    expect(legalDocumentPath('notices', environment)).toBe(
      '/Applications/OpenBranches.app/Contents/Resources/THIRD_PARTY_NOTICES.txt',
    );
    expect(legalDocumentPath('chromium', environment)).toBe(
      '/Applications/OpenBranches.app/Contents/Resources/LICENSES.chromium.html',
    );
  });

  it('uses source-controlled and Electron-provided files in development', () => {
    const environment = { packaged: false, resourcesPath: '/ignored', appPath: '/project' };
    expect(legalDocumentPath('notices', environment)).toBe('/project/THIRD_PARTY_NOTICES.md');
    expect(legalDocumentPath('chromium', environment)).toBe(
      '/project/node_modules/electron/dist/LICENSES.chromium.html',
    );
  });

  it('opens a disposable copy instead of a signed app resource', () => {
    expect(legalDocumentCopyPath('notices', '/private/tmp')).toBe(
      '/private/tmp/OpenBranches Legal/THIRD_PARTY_NOTICES.txt',
    );
    expect(legalDocumentCopyPath('chromium', '/private/tmp')).toBe(
      '/private/tmp/OpenBranches Legal/LICENSES.chromium.html',
    );
  });
});
