import type { Options } from '@wdio/types'

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./e2e/**/*.spec.ts'],
  maxInstances: 1,

  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: './src-tauri/target/debug/bundle/macos/hip.app/Contents/MacOS/hip',
      driverProvider: 'embedded',
    }],
  ],

  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/debug/bundle/macos/hip.app/Contents/MacOS/hip',
    },
  }],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  reporters: ['spec'],
}
