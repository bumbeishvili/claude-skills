// Audit config for the self-test (selftest.cjs serves this folder and sets SELFTEST_BASE).
module.exports = {
	name: 'accessibility-audit self-test',
	baseUrl: process.env.SELFTEST_BASE,
	viewports: { desktop: { width: 1280, height: 800 } },
	states: [
		{ id: 'failures', path: '/known-failures.html' },
		{ id: 'good', path: '/known-good.html' }
	],
	ready: async (page) => {
		await page.waitForLoadState('load');
		await page.waitForTimeout(300);
	},
	flows: [
		{
			id: 'failures-save',
			path: '/known-failures.html',
			steps: [
				{ label: 'Tab to Save', run: ({ a11y }) => a11y.tabTo(/button "Save"/), expect: { focus: /Save/ } },
				{ label: 'Enter', run: ({ page }) => page.keyboard.press('Enter'), expect: { focus: /Save/, announce: /Saved/ } }
			]
		},
		{
			id: 'failures-dismiss',
			path: '/known-failures.html',
			steps: [
				{ label: 'Tab to Dismiss', run: ({ a11y }) => a11y.tabTo(/button "Dismiss"/), expect: { focus: /Dismiss/ } },
				{ label: 'Enter removes the banner', run: ({ page }) => page.keyboard.press('Enter') }
			]
		},
		{
			id: 'failures-title',
			path: '/known-failures.html',
			steps: [
				{ label: 'Tab to "Jump to"', run: ({ a11y }) => a11y.tabTo(/combobox "Jump to"/), expect: { focus: /Jump to/ } },
				{ label: 'Choose Section', run: ({ page }) => page.locator('#f-select').selectOption('#changed'), expect: { focus: /Jump to/, title: /Section/ } }
			]
		},
		{
			id: 'good-save',
			path: '/known-good.html',
			steps: [
				{ label: 'Tab to Save', run: ({ a11y }) => a11y.tabTo(/button "Save"/), expect: { focus: /Save/ } },
				{ label: 'Enter', run: ({ page }) => page.keyboard.press('Enter'), expect: { focus: /Save/, announce: /Saved/, title: /Known good/ } }
			]
		}
	]
};
