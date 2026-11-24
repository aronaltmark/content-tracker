import { defineConfig } from '@playwright/test'

export default defineConfig({
	testDir: 'e2e',
	testMatch: '*.e2e.js',
	outputDir: 'test-results',
	timeout: 30 * 1000,
	workers: 1
})
