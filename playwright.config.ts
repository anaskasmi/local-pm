import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import { resolveRunContext } from './e2e/run-context'

dotenv.config()

const run = resolveRunContext()

const mongoServer =
  run.managesMongo && run.mongoPort !== null
    ? [
        {
          command: 'npx cross-env NODE_OPTIONS=--no-deprecation tsx e2e/mongo-server.ts',
          port: run.mongoPort,
          reuseExistingServer: false,
          timeout: 300_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
          env: { E2E_MONGO_PORT: String(run.mongoPort) },
        },
      ]
    : []

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  outputDir: run.outputDir,
  metadata: { run },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: run.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    ...mongoServer,
    {
      command: `npx cross-env NODE_OPTIONS=--no-deprecation next dev --port ${run.port}`,
      url: run.baseUrl,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NEXT_DIST_DIR: run.distDir,
        DATABASE_URI: run.databaseUri,
        PAYLOAD_SECRET: process.env.PAYLOAD_SECRET ?? 'e2e-secret-not-for-production',
        NEXT_PUBLIC_SERVER_URL: run.baseUrl,
        LOCAL_PM_REQUIRE_AUTH: 'false',
        LOCAL_PM_DISABLE_CYCLE_CRON: 'true',
        MONGO_SERVER_SELECTION_TIMEOUT_MS: '30000',
        MONGO_MIN_POOL_SIZE: process.env.MONGO_MIN_POOL_SIZE ?? '30',
      },
    },
  ],
})
