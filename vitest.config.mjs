import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: { include: ['{core,gui,scripts}/**/*.test.js'] }
})
