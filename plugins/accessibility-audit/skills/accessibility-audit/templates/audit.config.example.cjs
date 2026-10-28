// Audit config: copy to the project (default _raw/a11y/audit.config.cjs) and replace every value with the app's own.
// Read by audit.cjs, headed.cjs, voiceover.cjs and capture.cjs. playbook.md §1 describes every key.
const EXPLORER = '/data/explorer';

module.exports = {
	name: 'Example site (local dev)',
	// Local or staging only, never a host the person did not name: the probes press Enter on buttons and flows submit forms.
	baseUrl: 'http://localhost:5173',

	// "desktop" is required. A value is a viewport, or Playwright context options with a viewport.
	viewports: {
		desktop: { width: 1440, height: 900 },
		phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
	},

	// Third parties that are not part of the site under test (feedback widgets, chat, analytics), as regular expressions.
	block: ['marker\\.io', 'intercom'],

	// Runs in every page before the app's own scripts: dismiss first-visit tours and cookie banners the way a returning
	// visitor has. Keep one state without it if the banner itself needs auditing.
	init: () => localStorage.setItem('tour-seen', 'true'),

	// When the page is ready to measure. The default waits for network idle (30 s), which never comes on pages that poll.
	ready: async (page) => {
		await page.waitForLoadState('load');
		await page.locator('main h1').first().waitFor();
	},

	// Every state a user meets: initial pages, open menus and dialogs, errors, empty and loading states, phone layouts.
	// setup(page, a11y) gets there the way a keyboard user would; a11y.tabTo(/button "Filters"/) presses Tab until the
	// focused element's accessibility snapshot or CSS path matches, and a11y.press(key) presses one key.
	states: [
		{ id: 'home', path: '/' },
		{
			id: 'home-menu',
			path: '/',
			setup: async (page, a11y) => {
				await a11y.tabTo(/button "Menu"/);
				await a11y.press('Enter');
				await page.getByRole('menu').waitFor();
			}
		},
		{ id: 'explorer', path: EXPLORER, setup: async (page) => page.locator('figure svg').first().waitFor({ timeout: 30000 }) },
		{ id: 'explorer-phone', path: EXPLORER, viewport: 'phone' },
		{ id: 'about-dark', path: '/about', colorScheme: 'dark' },
		{ id: 'report-reduced', path: '/report', reducedMotion: 'reduce' }
	],

	// Pages for the per-page checks (reflow, zoom, text spacing, sticky bars, orientation, motion) and the cross-page
	// ones (consistent navigation, titles, help). Defaults to the states' paths.
	pages: ['/', EXPLORER, '/report', '/about', '/contact'],

	// Tasks done with the keyboard, step by step. After each step the runner records focus, live-region announcements
	// and the page title, and checks `expect`:
	//   focus     regular expression or text the focused element's snapshot line must match ('textbox "Email"')
	//   focusBody true when focus on <body> is intended (otherwise it is reported as focus lost)
	//   announce  what a live region must have said during the step
	//   fieldError selector of a field that must be aria-invalid with an error message tied to it
	//   title     what document.title must match after the step (single-page navigation)
	flows: [
		{
			id: 'newsletter-error',
			path: '/about',
			steps: [
				{ label: 'Tab to Newsletter', run: ({ a11y }) => a11y.tabTo(/button "Newsletter"/) },
				{ label: 'Enter opens the dialog', run: ({ page }) => page.keyboard.press('Enter'), expect: { focus: /textbox "Email address"/ } },
				{
					label: 'Submit a bad address',
					run: async ({ page }) => {
						await page.keyboard.type('not-an-email');
						await page.keyboard.press('Enter');
					},
					wait: 800,
					expect: { focus: /Email address/, fieldError: 'input[type="email"]', announce: /valid email/i }
				},
				{ label: 'Escape closes it', run: ({ page }) => page.keyboard.press('Escape'), expect: { focus: /button "Newsletter"/ } }
			]
		},
		{
			id: 'explorer-navigate',
			path: '/',
			steps: [
				{ label: 'Tab to Data explorer', run: ({ a11y }) => a11y.tabTo(/link "Data explorer"/) },
				{ label: 'Enter follows it', run: ({ page }) => page.keyboard.press('Enter'), wait: 1500, expect: { title: /Explorer/, focus: /heading|main|Skip/ } }
			]
		}
	],

	// Elements axe should leave out: third-party embeds the team cannot change. Name them in the report's scope.
	exclude: ['iframe[src*="tiktok.com"]'],

	// Optional: layers to skip for every run (engines, structure, contrast, keyboard, speech, hover, probes, visual,
	// crosspage, documents, flows), the output folder, and limits.
	// skip: ['documents'],
	// out: '_raw/a11y',
	// maxStops: 400,
	// measureFocus: true,
	// transcriptMax: 4000,
	// locale: 'en-US',
	// desktopViewport: 'desktop'
};
