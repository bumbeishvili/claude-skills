// A project's tour: copy into the video folder (outside the repo), set APP_URL and the
// selectors, then one segment per narration line, in narration order. It uses the common
// pieces only; playbook.md has the rest, and SKILL.md says when each one helps.
//   node <skill>/voice.cjs <videoDir>
//   NODE_PATH="$(npm root -g)" node tour.cjs <videoDir> dry     look at <videoDir>/dry/*.png
//   NODE_PATH="$(npm root -g)" node tour.cjs <videoDir> rec
//   node <skill>/build.cjs <videoDir> && node <skill>/verify.cjs <videoDir>
const path = require('path');
const { record } = require(path.join(process.env.EXPLAINER_VIDEO_SKILL || path.join(__dirname, '..'), 'tour-kit.cjs'));

const DIR = process.argv[2];
const APP_URL = 'http://localhost:5173/';           // the running app; never a production account
const ADDRESS = 'example.com';                      // what the intro types into the address bar

record({
  dir: DIR,
  url: APP_URL,
  mode: process.argv[3] || 'dry',
  callouts: 'label',   // captions carry each line; a callout names the part in two or three words
  // Before the first page: a demo login, made-up data served by route, settings in storage.
  // Never film a real account or real people's data.
  prepare: async (context) => {
    // await context.addCookies([...]);                          // a demo session
    // await context.route('**/api/items', r => r.fulfill({ json: DEMO_ITEMS }));
  },
  // Until the app is ready to film: data loaded, spinners gone, fonts in.
  ready: async (page) => {
    await page.waitForSelector('main');
    await page.evaluate(() => document.fonts.ready);
  },
  tour: async (t) => {
    // The opening: the voice starts at once, the address is typed on "portal" and the page
    // zooms to full screen on "every", about 2.4 s later (the page has to load first).
    await t.intro({ id: 'welcome', address: ADDRESS, voiceFirst: true, typeAtWord: 'portal', zoomAtWord: 'every' });

    // A click timed to the word that names it; the callout keeps clear of the button.
    await t.segment('create', async () => {
      await t.spot(['#new-page-button'], 6);
      await t.say('create', 'New page', ['#new-page-button'], 'right', 6, ['#new-page-button']);
      await t.glideTo('#new-page-button', 600);
      await t.untilWord('create', 'New');
      await t.click();
    });

    // Typing, and a native <select> picked through the overlay menu.
    await t.segment('fill', async () => {
      await t.spot(['form'], 6);
      await t.say('fill', 'Content', ['form'], 'right', 6, ['form']);
      await t.typeInto('input[name="title"]', 'Spring opening hours');
      await t.untilWord('fill', 'status');
      await t.pickOption('select[name="status"]', 'draft');
    });

    // A wait the viewer should not sit through (saving, a list loading) is cut out.
    // Keep it outside any spoken line: build.cjs refuses a cut under speech.
    await t.segment('save', async () => {
      await t.tipOff();
      await t.clickOn('button[type="submit"]', 600);
      await t.offCamera(() => t.page.waitForSelector('.toast-saved'));
      await t.spot(['.toast-saved'], 6);
      await t.say('save', 'Saved', ['.toast-saved'], 'bottom', 6);
    });

    // The closing card, with the voice over it.
    await t.segment('outro', async () => {
      await t.tipOff();
      await t.spotOff();
      await t.card({ title: 'Your product', subtitle: ADDRESS });
      await t.pause(300);
      await t.speak('outro');
      await t.pause(1200);
    });
  },
}).catch((e) => { console.error(e); process.exit(1); });
