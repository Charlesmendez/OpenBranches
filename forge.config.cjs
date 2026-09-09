const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const signRelease = process.env.OPENBRANCHES_SIGN_RELEASE === '1';
if (
  signRelease &&
  !['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].every((key) => process.env[key])
) {
  throw new Error('Release signing requires an Apple ID, app-specific password, and team ID.');
}
module.exports = {
  packagerConfig: {
    asar: true,
    appBundleId: 'com.openbranches.desktop',
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
