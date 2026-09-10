import { join } from 'node:path';

export const legalDocumentKinds = ['notices', 'chromium'] as const;
export type LegalDocumentKind = (typeof legalDocumentKinds)[number];

const filenames: Record<LegalDocumentKind, string> = {
  notices: 'THIRD_PARTY_NOTICES.txt',
  chromium: 'LICENSES.chromium.html',
};

export function legalDocumentPath(
  kind: LegalDocumentKind,
  environment: { packaged: boolean; resourcesPath: string; appPath: string },
) {
  if (environment.packaged) return join(environment.resourcesPath, filenames[kind]);
  return kind === 'notices'
    ? join(environment.appPath, 'THIRD_PARTY_NOTICES.md')
    : join(environment.appPath, 'node_modules', 'electron', 'dist', filenames[kind]);
}

export function legalDocumentCopyPath(kind: LegalDocumentKind, temporaryPath: string) {
  return join(temporaryPath, 'OpenBranches Legal', filenames[kind]);
}
