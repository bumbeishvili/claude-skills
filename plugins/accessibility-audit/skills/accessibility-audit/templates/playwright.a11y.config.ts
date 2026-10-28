// Accessibility regression tests: tests/a11y/*.a11y.spec.ts, run with `npx playwright test -c playwright.a11y.config.ts`
// (or an npm script such as "test:a11y"). Starts the dev server unless one is already up on the port.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 5173);

export default defineConfig({
	testDir: 'tests/a11y',
	testMatch: '*.a11y.spec.ts',
	fullyParallel: true,
	reporter: 'list',
	use: {
		baseURL: process.env.BASE_URL ?? `http://localhost:${PORT}`,
		viewport: { width: 1440, height: 900 },
		trace: 'retain-on-failure'
	},
	// Add a firefox project once these pass in Chromium; WebKit hung on macOS 14 with Playwright 1.64 (playbook §11).
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
	webServer: {
		command: `npm run dev -- --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: true,
		timeout: 120_000
	}
});
