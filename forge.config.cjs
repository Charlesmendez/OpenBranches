const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const { join } = require('node:path');
const { openbranches } = require('./package.json');
const signRelease = process.env.OPENBRANCHES_SIGN_RELEASE === '1';
if (
  signRelease &&
  !['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'GITHUB_APP_CLIENT_ID'].every(
    (key) => process.env[key],
  )
) {
  throw new Error(
    'Release packaging requires Apple notarization credentials and the public GitHub App client ID.',
  );
}
module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: openbranches.bundleIdentifier,
    extraResource: [
      join(__dirname, 'dist-legal', 'OPENBRANCHES_LICENSE.txt'),
      join(__dirname, 'dist-legal', 'THIRD_PARTY_NOTICES.txt'),
      join(__dirname, 'dist-legal', 'LICENSES.chromium.html'),
    ],
    ignore: (path) =>
      path !== '' &&
      !/^\/(dist|dist-electron|assets|package\.json|README\.md|LICENSE)(\/|$)/.test(path),
    icon: 'assets/icon.icns',
    ...(signRelease && {
      osxSign: {},
      osxNotarize: {
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID,
      },
    }),
  },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['darwin'] }],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
