// Helpers for the project's accessibility regression tests (tests/a11y/helpers.ts). Every fix leaves a test that
// fails on the old code and passes on the new; these cover what most of those tests check.
// Needs: npm i -D @playwright/test @axe-core/playwright
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Aborts requests to third parties that are not part of the site under test (feedback widgets, chat, analytics). */
export async function blockThirdParties(context: BrowserContext, patterns: RegExp[]) {
	for (const pattern of patterns) await context.route(pattern, (route) => route.abort());
}

/** Fails on axe violations of WCAG 2.2 A/AA at the given impacts, listing rule, help and elements. */
export async function expectNoAxeViolations(page: Page, { impacts = ['critical', 'serious'], exclude = [] as string[] } = {}) {
	let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
	for (const selector of exclude) builder = builder.exclude(selector);
	const results = await builder.analyze();
	const blocking = results.violations
		.filter((v) => impacts.includes(v.impact ?? ''))
		.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
	expect(blocking).toEqual([]);
}

/** Presses Tab until `target` has focus; returns the number of presses, the cost of reaching it by keyboard. */
export async function tabTo(page: Page, target: Locator, limit = 150): Promise<number> {
	for (let presses = 0; presses <= limit; presses++) {
		if (await target.evaluate((el) => el === document.activeElement)) return presses;
		await page.keyboard.press('Tab');
	}
	throw new Error(`${target} was not reached within ${limit} Tab presses`);
}

/** The accessible names of the first `count` Tab stops from the top of the page, for asserting focus order. */
export async function tabSequence(page: Page, count: number): Promise<string[]> {
	const names: string[] = [];
	for (let i = 0; i < count; i++) {
		await page.keyboard.press('Tab');
		const snapshot = await page.locator(':focus').ariaSnapshot();
		names.push(snapshot.split('\n')[0].replace(/^- /, ''));
	}
	return names;
}

/**
 * The focused control looks different from the unfocused one: the region around it is captured with focus and
 * without, and the pixels must differ. Catches outline: none, rings clipped by overflow: hidden, and rings drawn in
 * the page's own colour. Focus arrives with keyboard modality, so :focus-visible applies.
 */
export async function expectVisibleFocus(page: Page, target: Locator, pad = 8) {
	await target.scrollIntoViewIfNeeded();
	const box = await target.boundingBox();
	if (!box) throw new Error(`${target} has no box to capture`);
	const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad };
	await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
	const unfocused = await page.screenshot({ clip, animations: 'disabled' });
	await page.keyboard.press('Shift');
	await target.focus();
	const focused = await page.screenshot({ clip, animations: 'disabled' });
	expect(focused.equals(unfocused), `${target} shows no visible change when focused`).toBe(false);
}

/** Records live-region announcements in every page of the context; call before page.goto. */
export async function recordAnnouncements(context: BrowserContext) {
	await context.addInitScript(() => {
		const said: string[] = [];
		(window as unknown as { __said: string[] }).__said = said;
		const live = (node: Node | null) => (node instanceof Element ? node : node?.parentElement)?.closest('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"], [role="log"], output');
		new MutationObserver((mutations) => {
			for (const m of mutations) {
				const region = live(m.target);
				if (region && region.textContent?.trim()) said.push(region.textContent.trim());
			}
		}).observe(document, { subtree: true, childList: true, characterData: true });
	});
}

/** Runs `action` and expects a live region to say something matching `pattern` meanwhile. */
export async function expectAnnounced(page: Page, action: () => Promise<void>, pattern: RegExp) {
	await page.evaluate(() => ((window as unknown as { __said: string[] }).__said.length = 0));
	await action();
	await expect.poll(() => page.evaluate(() => (window as unknown as { __said: string[] }).__said.join(' | '))).toMatch(pattern);
}

/** No sideways scrolling at 320 CSS px (WCAG 1.4.10), with `exempt` elements (data tables, maps) scrolling inside. */
export async function expectReflow(page: Page) {
	await page.setViewportSize({ width: 320, height: 640 });
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow, 'page scrolls sideways at 320 px').toBeLessThanOrEqual(1);
}
