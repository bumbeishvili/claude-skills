// One spec per flow in tests/a11y/<flow>.a11y.spec.ts. Each test names the finding it guards, so a failure says
// what came back. Replace the routes, names and selectors with the app's own.
import { test, expect } from '@playwright/test';
import { blockThirdParties, expectAnnounced, expectNoAxeViolations, expectReflow, expectVisibleFocus, recordAnnouncements, tabSequence, tabTo } from './helpers';

test.describe('site shell', () => {
	test.beforeEach(async ({ context }) => {
		await blockThirdParties(context, [/marker\.io/]);
		await recordAnnouncements(context);
	});

	for (const path of ['/', '/about', '/report']) {
		test(`no serious axe violations on ${path}`, async ({ page }) => {
			await page.goto(path, { waitUntil: 'networkidle' });
			await expectNoAxeViolations(page);
		});
	}

	// Skip link first, and Enter on it moves focus into main (WCAG 2.4.1).
	test('skip link moves focus to the main content', async ({ page }) => {
		await page.goto('/');
		expect((await tabSequence(page, 1))[0]).toBe('link "Skip to main content"');
		await page.keyboard.press('Enter');
		await page.keyboard.press('Tab');
		await expect(page.locator('main :focus, main:focus')).toHaveCount(1);
	});

	// Header order matches the layout (WCAG 2.4.3).
	test('header Tab order', async ({ page }) => {
		await page.goto('/');
		expect(await tabSequence(page, 4)).toEqual(['link "Skip to main content"', 'link "Home"', 'link "Data explorer"', 'button "Menu"']);
	});

	// Menu button: Enter opens on the first item, arrows move, Escape closes with focus back on the button.
	test('menu keyboard pattern', async ({ page }) => {
		await page.goto('/');
		const button = page.getByRole('button', { name: 'Menu' });
		await tabTo(page, button);
		await page.keyboard.press('Enter');
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('menuitem').first()).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(button).toBeFocused();
		await expect(button).toHaveAttribute('aria-expanded', 'false');
	});

	// Dialog: modal, focus inside on open, Escape closes and returns focus to the opener (WCAG 2.4.3).
	test('newsletter dialog focus', async ({ page }) => {
		await page.goto('/about');
		const opener = page.getByRole('button', { name: 'Newsletter' });
		await tabTo(page, opener);
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Sign up for our newsletter' });
		await expect(dialog).toHaveAttribute('aria-modal', 'true');
		await expect(dialog.getByRole('textbox', { name: 'Email address' })).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(dialog).toHaveCount(0);
		await expect(opener).toBeFocused();
	});

	// Form error: field marked invalid, message tied to it, announced (WCAG 3.3.1, 4.1.3).
	test('newsletter error is tied to the field and announced', async ({ page }) => {
		await page.goto('/about');
		await page.getByRole('button', { name: 'Newsletter' }).click();
		const email = page.getByRole('textbox', { name: 'Email address' });
		await email.fill('not-an-email');
		await expectAnnounced(page, () => email.press('Enter'), /valid email/i);
		await expect(email).toHaveAttribute('aria-invalid', 'true');
		await expect(email).toHaveAccessibleDescription(/valid email/i);
	});

	// Focus ring visible on the dark footer (WCAG 2.4.7, 1.4.11).
	test('footer links show focus', async ({ page }) => {
		await page.goto('/');
		await expectVisibleFocus(page, page.getByRole('contentinfo').getByRole('link').first());
	});

	// Accessible names and states of a widget, as a screen reader gets them.
	test('tabs expose names and selection', async ({ page }) => {
		await page.goto('/data/explorer');
		await expect(page.getByRole('tablist', { name: 'Views' })).toMatchAriaSnapshot(`
			- tablist "Views":
			  - tab "Explore" [selected]
			  - tab "Compare"
			  - tab "Regression"
		`);
	});

	// Reflow at 320 CSS px (WCAG 1.4.10).
	test('about page reflows at 320 px', async ({ page }) => {
		await page.goto('/about');
		await expectReflow(page);
	});

	// Single-page navigation updates the title and moves focus (WCAG 2.4.2, 2.4.3).
	test('navigation to the explorer updates title and focus', async ({ page }) => {
		await page.goto('/');
		await tabTo(page, page.getByRole('link', { name: 'Data explorer' }));
		await page.keyboard.press('Enter');
		await expect(page).toHaveTitle(/Explorer/);
		await expect(page.locator('main h1:focus, main:focus, #main:focus')).toHaveCount(1);
	});
});
