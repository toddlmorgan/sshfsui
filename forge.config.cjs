require('dotenv').config()
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const packagerConfig = {
  asar: true,
};

if (process.env.SKIP_SIGNING !== '1') {
  packagerConfig.osxSign = {};
  if (process.env.APPLE_ID && process.env.APPLE_ID_PASSWORD && process.env.TEAM_ID) {
    packagerConfig.osxNotarize = {
      tool: 'notarytool',
      appleId: process.env.APPLE_ID,
      appleIdPassword: process.env.APPLE_ID_PASSWORD,
      teamId: process.env.TEAM_ID
    };
  }
}

module.exports = {
  packagerConfig,
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    process.env.SKIP_SIGNING === '1'
      ? {
          name: '@electron-forge/maker-zip',
          platforms: ['darwin'],
          config: {},
        }
      : {
          name: '@electron-forge/maker-dmg',
          config: {
            format: 'ULFO',
          },
        }
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
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
