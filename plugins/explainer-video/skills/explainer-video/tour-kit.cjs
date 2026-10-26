// Records a narrated, cursor-driven tour of a web app at 1920x1080. A project's tour
// script calls record() with its own segments; voice.cjs must have voiced the
// narration first, and build.cjs turns the recording into the video.
//
//   NODE_PATH="$(npm root -g)" node tour.cjs <videoDir> dry   a still at the end of every segment
//   NODE_PATH="$(npm root -g)" node tour.cjs <videoDir> rec   frames + timeline.json for build.cjs
//   STOP_AFTER=<segment id> ...                               end a take early; rec still writes it
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ease = (k) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
class StopAfter extends Error {}

// Everything drawn on top of the app: cursor, click ripple, spotlight, callout, keycap,
// a menu standing in for native <select> popups, an illustrative AI chat, and the
// browser window of the intro. Installed on every page load; all of it ignores the
// mouse, so the app underneath gets every real click and hover.
function installOverlay() {
  const arrow = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><path d="M3 2 L3 22 L8.2 17.2 L11.8 25 L15.2 23.5 L11.7 15.9 L18.6 15.9 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  const lock = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="#6b6f86"/><path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="#6b6f86" stroke-width="1.5"/></svg>`;
  const ink = '#23234f', accent = '#8676ff', accentDeep = '#c64eff';
  const move = 'cubic-bezier(.4,0,.2,1)';
  const style = document.createElement('style');
  style.textContent = `
    #demo-layer, #demo-layer * { pointer-events: none !important; }
    #demo-layer { position: fixed; inset: 0; z-index: 2147483000; }
    #demo-spot { position: fixed; border-radius: 14px; opacity: 0;
      box-shadow: 0 0 0 3px ${accent}, 0 0 0 9999px rgba(30, 26, 70, .30);
      transition: left .5s ${move}, top .5s ${move}, width .5s ${move}, height .5s ${move}, opacity .35s; }
    #demo-tip { position: fixed; max-width: 330px; padding: 12px 16px 14px; border-radius: 12px;
      background: ${ink}; color: #fff; font: 600 17px/1.38 'Open Sans', system-ui, sans-serif;
      box-shadow: 0 14px 34px rgba(20, 16, 60, .35); opacity: 0; transform: translateY(8px);
      transition: opacity .28s, transform .28s ${move}; }
    #demo-tip.on { opacity: 1; transform: none; }
    #demo-tip .lab { display: inline-block; margin-bottom: 7px; padding: 1px 9px; border-radius: 999px;
      background: linear-gradient(90deg, ${accent}, ${accentDeep});
      font: 700 11px/1.7 'Open Sans', system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
    #demo-tip .txt { display: block; }
    #demo-tip.big { max-width: none; padding: 18px 28px; text-align: center; font-size: 26px; }
    #demo-cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px;
      background: url("data:image/svg+xml,${encodeURIComponent(arrow)}") no-repeat;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .35)); }
    .demo-ripple { position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
      border: 3px solid ${accent}; background: rgba(134, 118, 255, .18);
      animation: demo-ripple .55s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.2); opacity: 1 } to { transform: scale(1.35); opacity: 0 } }
    #demo-key { position: fixed; padding: 3px 9px; border-radius: 7px; background: #fff; color: ${ink};
      border: 1px solid #c5c1ec; box-shadow: 0 2px 0 #c5c1ec; font: 700 13px/1.4 'Open Sans', system-ui, sans-serif;
      white-space: nowrap; opacity: 0; transition: opacity .2s; }
    #demo-menu { position: fixed; min-width: 200px; padding: 5px; border-radius: 10px; background: #fff;
      border: 1px solid #dbdff1; box-shadow: 0 12px 30px rgba(20, 16, 60, .22); font: 500 13px/1.3 'Open Sans', system-ui, sans-serif;
      color: ${ink}; opacity: 0; transform: translateY(-4px); transition: opacity .18s, transform .18s; }
    #demo-menu.on { opacity: 1; transform: none; }
    #demo-menu .row { padding: 7px 10px; border-radius: 6px; white-space: nowrap; }
    #demo-menu .row.cur { font-weight: 700; } #demo-menu .row.hl { background: #eeebff; color: #5b4bd6; }
    #demo-chat { position: fixed; right: 26px; top: 64px; width: 540px; height: 600px; border-radius: 14px; background: #fff;
      box-shadow: 0 24px 60px rgba(15, 12, 45, .45); display: flex; flex-direction: column; overflow: hidden;
      font: 400 13px/1.45 'Open Sans', system-ui, sans-serif; color: #1f2333; transform: translateX(120%); transition: transform .45s ${move}; }
    #demo-chat.on { transform: none; }
    #demo-chat .hd { display: flex; align-items: center; gap: 7px; padding: 12px 16px; border-bottom: 1px solid #eceef5; font-weight: 700; }
    #demo-chat .hd i { width: 10px; height: 10px; border-radius: 50%; background: #e3e5ee; }
    #demo-chat .hd b { margin-left: 8px; }
    #demo-chat .msgs { flex: 1; overflow: hidden; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    #demo-chat .user { align-self: flex-end; max-width: 82%; padding: 10px 13px; border-radius: 14px 14px 4px 14px; background: #f0eeff;
      font-size: 12px; white-space: pre-wrap; color: #34306a; }
    #demo-chat .bot { display: flex; flex-direction: column; gap: 6px; min-height: 0; flex: 1; }
    #demo-chat .bot .note { color: #6b6f86; }
    #demo-chat .code { flex: 1; min-height: 0; display: flex; flex-direction: column; border-radius: 10px; background: #1d1f2b; overflow: hidden; }
    #demo-chat .code-hd { display: flex; justify-content: space-between; padding: 7px 12px; background: #2a2d3d; color: #aeb3cf; font-size: 11px; }
    #demo-chat .code pre { margin: 0; padding: 10px 12px; flex: 1; overflow: hidden; color: #d9dcf2; font: 11px/1.5 'JetBrains Mono', ui-monospace, monospace; white-space: pre; }
    #demo-chat .input { display: flex; align-items: center; gap: 10px; margin: 12px 16px 16px; padding: 11px 14px; border: 1px solid #dfe2ee; border-radius: 12px; color: #9aa0b8; }
    #demo-chat .input .txt { flex: 1; color: #1f2333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #demo-chat-send { width: 28px; height: 28px; border-radius: 50%; background: ${accent}; color: #fff; display: grid; place-items: center; font-size: 13px; }
    #demo-browser { position: fixed; inset: 0; background: #e9ebf2; display: none; opacity: 0; transition: opacity .35s; }
    #demo-browser.on { display: block; opacity: 1; }
    #demo-browser .bar { position: absolute; left: 0; right: 0; top: 0; height: 56px; display: flex; align-items: center; gap: 8px;
      padding: 0 18px; background: #e9ebf2; border-bottom: 1px solid #d9dce6; z-index: 1; transition: transform .6s ${move}; }
    #demo-browser .bar i { width: 12px; height: 12px; border-radius: 50%; background: #c9ccd8; }
    #demo-browser .url { margin-left: 18px; width: 640px; height: 34px; display: flex; align-items: center; gap: 9px; padding: 0 14px;
      border-radius: 17px; background: #fff; border: 1px solid #d5d8e3; font: 500 16px 'Open Sans', system-ui, sans-serif; color: ${ink}; }
    #demo-browser .url .lock { width: 14px; height: 14px; flex: none; background: url("data:image/svg+xml,${encodeURIComponent(lock)}") no-repeat center; }
    #demo-browser .url .caret { width: 1.5px; height: 18px; background: ${ink}; animation: demo-blink 1s steps(1) infinite; }
    @keyframes demo-blink { 50% { opacity: 0; } }
    #demo-browser .page { position: absolute; left: 0; right: 0; top: 57px; bottom: 0; background: #fff; transition: opacity .3s; }
    #demo-browser .shot { position: fixed; left: 0; top: 0; transform-origin: 0 0; opacity: 0; transition: transform .9s ${move}, opacity .35s; }
    #demo-browser.loaded .shot { opacity: 1; }
    #demo-browser.zoom .bar { transform: translateY(-100%); }
    #demo-browser.zoom .page { opacity: 0; }
    #demo-browser.zoom .shot { transform: none !important; }
  `;
  document.head.appendChild(style);
  const layer = document.createElement('div');
  layer.id = 'demo-layer';
  layer.innerHTML = '<div id="demo-browser"><div class="bar"><i></i><i></i><i></i><div class="url"><span class="lock"></span><span class="txt"></span><span class="caret"></span></div></div><div class="page"></div><img class="shot" alt=""></div>'
    + '<div id="demo-spot"></div><div id="demo-menu"></div>'
    + '<div id="demo-chat"><div class="hd"><i></i><i></i><i></i><b>AI chat</b></div><div class="msgs"></div>'
    + '<div class="input"><span class="txt">Message the AI…</span><span id="demo-chat-send">➤</span></div></div>'
    + '<div id="demo-tip"><span class="lab"></span><span class="txt"></span></div><div id="demo-key"></div><div id="demo-cursor"></div>';
  document.body.appendChild(layer);
  const $ = (id) => document.getElementById(id);
  const cursor = $('demo-cursor'), key = $('demo-key'), spot = $('demo-spot'), tip = $('demo-tip');
  const menu = $('demo-menu'), chat = $('demo-chat'), browser = $('demo-browser');
  const at = { x: -50, y: -50 };
  const placeCursor = () => {
    cursor.style.transform = `translate(${at.x - 3}px, ${at.y - 2}px)`;
    key.style.transform = `translate(${at.x + 22}px, ${at.y + 18}px)`;
  };
  window.addEventListener('mousemove', (e) => { at.x = e.clientX; at.y = e.clientY; placeCursor(); }, true);
  const rippleAt = (x, y) => {
    const ripple = document.createElement('div');
    ripple.className = 'demo-ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    layer.insertBefore(ripple, cursor);
    setTimeout(() => ripple.remove(), 600 * window.__DEMO_TIME);
  };
  window.addEventListener('mousedown', (e) => rippleAt(e.clientX, e.clientY), true);

  const rectOf = (selectors, pad) => {
    const rects = selectors.map(s => document.querySelector(s)).filter(Boolean)
      .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
    if (!rects.length) throw new Error('demo: nothing visible for ' + selectors.join(', '));
    const left = Math.min(...rects.map(r => r.left)) - pad, top = Math.min(...rects.map(r => r.top)) - pad;
    const right = Math.max(...rects.map(r => r.right)) + pad, bottom = Math.max(...rects.map(r => r.bottom)) + pad;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  // While following, a target can vanish for a moment (a re-render); keep the last place then.
  const rectOfOrNull = (selectors, pad) => { try { return rectOf(selectors, pad); } catch (e) { return null; } };
  let spotTarget = null, spotSettle = null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  window.__demo = {
    // Slides to the target, then follows it every frame (a modal that grows, a
    // panel that slides in) until the next spot or spotOff.
    spot(selectors, pad = 8) {
      const place = (r) => Object.assign(spot.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      spotTarget = { selectors, pad };
      spot.style.transition = '';
      place(rectOf(selectors, pad));
      spot.style.opacity = 1;
      clearTimeout(spotSettle);
      spotSettle = setTimeout(() => {
        spot.style.transition = 'opacity .35s';
        const follow = () => {
          if (!spotTarget || spotTarget.selectors !== selectors) return;
          const r = rectOfOrNull(selectors, pad);
          if (r) place(r);
          requestAnimationFrame(follow);
        };
        follow();
      }, 520 * window.__DEMO_TIME);
    },
    spotOff() { spotTarget = null; spot.style.opacity = 0; },
    // side: right | left | top | bottom | inside | inside-right | inside-bottom-left | inside-bottom-right | center.
    // `avoid`: selectors of controls the cursor works on; when the preferred side
    // would cover one, the first side that covers none is used instead.
    tip(label, text, selectors, side, pad = 8, avoid = []) {
      tip.querySelector('.lab').textContent = label;
      tip.querySelector('.lab').style.display = label ? '' : 'none';
      tip.querySelector('.txt').textContent = text;
      tip.classList.toggle('big', side === 'center');
      const w = tip.offsetWidth, h = tip.offsetHeight, gap = 18, vw = innerWidth, vh = innerHeight;
      const r = side === 'center' ? null : rectOf(selectors, pad);
      const place = (sd) => {
        let x, y;
        if (sd === 'center') { x = (vw - w) / 2; y = (vh - h) / 2; }
        else if (sd === 'right') { x = r.right + gap; y = r.top; }
        else if (sd === 'left') { x = r.left - gap - w; y = r.top + 40; }
        else if (sd === 'top') { x = r.left; y = r.top - gap - h; }
        else if (sd === 'bottom') { x = r.right - w; y = r.bottom + gap; }
        else if (sd === 'inside-right') { x = r.right - w - 30; y = r.top + 30; }
        else if (sd === 'inside-bottom-left') { x = r.left + 30; y = r.bottom - h - 30; }
        else if (sd === 'inside-bottom-right') { x = r.right - w - 30; y = r.bottom - h - 30; }
        else { x = r.left + 70; y = r.top + 26; }
        return { x: clamp(x, 12, vw - w - 12), y: clamp(y, 12, vh - h - 12) };
      };
      const covers = (p) => avoid.some(sel => {
        const a = rectOfOrNull([sel], 14);
        return a && p.x < a.right && p.x + w > a.left && p.y < a.bottom && p.y + h > a.top;
      });
      let pos = place(side);
      if (r && covers(pos)) {
        const free = [side, 'right', 'left', 'bottom', 'top', 'inside', 'inside-right', 'inside-bottom-left', 'inside-bottom-right'].map(place).find(p => !covers(p));
        if (free) pos = free;
      }
      tip.style.left = pos.x + 'px';
      tip.style.top = pos.y + 'px';
      tip.classList.add('on');
    },
    tipOff() { tip.classList.remove('on'); },
    key(text) { if (text) key.textContent = text; key.style.opacity = text ? 1 : 0; },
    ripple(x, y) { rippleAt(x, y); },
    centerOf(selector) {
      const el = document.querySelector(selector);
      if (!el) throw new Error('demo: no element for ' + selector);
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    // Hidden while the page's own picture is taken for the intro's zoom.
    hideLayer(hidden) { layer.style.visibility = hidden ? 'hidden' : ''; },
    browserShow() {
      browser.style.transition = 'none';
      browser.className = 'on';
      browser.querySelector('.url .txt').textContent = '';
      void browser.offsetWidth;
      browser.style.transition = '';
    },
    browserType(text, ms) {
      const el = browser.querySelector('.url .txt'), start = performance.now(), total = ms * window.__DEMO_TIME;
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / total);
        el.textContent = text.slice(0, Math.round(text.length * k));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    browserLoad(src) {
      const img = browser.querySelector('.shot'), top = 57, k = (innerHeight - top) / innerHeight;
      img.src = src;
      // The picture is device pixels; show it at the viewport's CSS size.
      img.style.width = innerWidth + 'px';
      img.style.height = innerHeight + 'px';
      img.style.transform = `translate(${(innerWidth * (1 - k)) / 2}px, ${top}px) scale(${k})`;
      browser.classList.add('loaded');
    },
    browserZoom() { browser.classList.add('zoom'); },
    browserHide() { browser.classList.remove('on'); },
    // A stand-in for a native <select>'s popup, which screenshots never show.
    menu(selector, labels, current) {
      const r = document.querySelector(selector).getBoundingClientRect();
      menu.innerHTML = labels.map((t, i) => `<div class="row${i === current ? ' cur' : ''}" id="demo-menu-${i}">${t.replace(/</g, '&lt;')}</div>`).join('');
      menu.style.left = r.left + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
      menu.classList.add('on');
    },
    menuHighlight(i) { menu.querySelectorAll('.row').forEach((row, k) => row.classList.toggle('hl', k === i)); },
    menuOff() { menu.classList.remove('on'); },
    // The illustrative AI chat (not a real service): a window, a pasted prompt, a reply written in, a copy button.
    chatOpen() { chat.querySelector('.msgs').innerHTML = ''; chat.classList.add('on'); },
    chatType(text) { chat.querySelector('.input .txt').textContent = text; },
    chatSend(prompt, reply, ms, note, lang) {
      const msgs = chat.querySelector('.msgs');
      const lines = prompt.split('\n').filter(l => l.trim());
      msgs.innerHTML = `<div class="user"></div><div class="bot"><div class="note"></div><div class="code"><div class="code-hd"><span></span><span id="demo-chat-copy">Copy code</span></div><pre></pre></div></div>`;
      msgs.querySelector('.user').textContent = lines.slice(0, 3).join('\n') + (lines.length > 3 ? `\n… ${lines.length - 3} more lines` : '');
      msgs.querySelector('.note').textContent = note;
      msgs.querySelector('.code-hd span').textContent = lang;
      chat.querySelector('.input .txt').textContent = 'Message the AI…';
      const pre = msgs.querySelector('pre'), start = performance.now(), total = ms * window.__DEMO_TIME;
      window.__demoChatDone = false;
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / total);
        pre.textContent = reply.slice(0, Math.round(reply.length * k));
        pre.scrollTop = pre.scrollHeight;
        if (k < 1) requestAnimationFrame(step); else window.__demoChatDone = true;
      };
      requestAnimationFrame(step);
    },
    chatCopied() { document.getElementById('demo-chat-copy').textContent = 'Copied ✓'; },
    chatClose() { chat.classList.remove('on'); },
  };
}

async function record(options) {
  const {
    dir, url, mode = 'dry',
    viewport = { width: 1280, height: 720 },
    scale = 1.5,          // the layout rendered at 1.5x: 1920x1080 frames from a 1280x720 viewport
    // Recorded this many times slower than it plays: the screenshot loop manages ~15
    // fps on a busy page, ~30 once build.cjs plays it back at normal speed.
    time = 2,
    speechPadMs = 300,    // silence after each narration line
    prepare,              // async (context): init scripts, routes, storage, before the first page
    ready,                // async (page): wait until the app is ready to film
    tour,                 // async (t): the segments
  } = options;
  if (!dir || !url || !tour) throw new Error('record() needs dir, url and tour');
  if (mode !== 'dry' && mode !== 'rec') throw new Error(`mode is "dry" or "rec", not "${mode}"`);
  const lines = JSON.parse(fs.readFileSync(path.join(dir, 'narration.json'), 'utf8'));
  const unvoiced = lines.filter(l => !(l.dur > 0)).map(l => l.id);
  if (unvoiced.length) throw new Error(`Voice the narration first (node voice.cjs ${dir}); no length yet for: ${unvoiced.join(', ')}`);
  const lineById = Object.fromEntries(lines.map(l => [l.id, l]));
  const line = (id) => { if (!lineById[id]) throw new Error(`No narration line "${id}" in narration.json`); return lineById[id]; };
  // What the callout shows: the line, or its `card` when the screen should read differently
  // from what is spoken (the address on the closing card, while the voice says "this portal").
  const onScreen = (id) => line(id).card || line(id).text;
  const pause = (ms) => sleep(ms * time);   // a choreography pause, in video time

  const browser = await chromium.launch();
  const timeline = { time, viewport, scale, segs: [], says: [], cuts: [], frames: [] };
  const mark = (list, extra) => list.push({ t: Date.now() / 1000, ...extra });
  let capturing = false, captureErrors = 0, capture = Promise.resolve(), finished = false;
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    await context.addInitScript(`window.__DEMO_TIME = ${time}; document.addEventListener('DOMContentLoaded', ${installOverlay.toString()})`);
    if (prepare) await prepare(context);
    const page = await context.newPage();
    page.on('pageerror', e => console.log('PAGEERROR', e.message));
    const cdp = await context.newCDPSession(page);
    // CSS transitions and animations (the app's and the overlay's) at 1/time speed. A
    // new document starts at full speed, so this runs again after each navigation.
    const slowMotion = async () => { await cdp.send('Animation.enable'); await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / time }); };
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    if (ready) await ready(page);
    await page.waitForFunction(() => window.__demo, null, { timeout: 30000 });
    await slowMotion();
    await sleep(600);

    // Frames from Chrome's own screenshot at clip scale: its screencast only delivers
    // the CSS size (1280x720). PNG, because JPEG noise costs the web encode more bits than it saves.
    const clip = { x: 0, y: 0, width: viewport.width, height: viewport.height, scale };
    // One capture at a time: a clip capture briefly overrides the page's scale, and two
    // interleaved ones (the frame loop and the intro's picture) can come back tiled.
    let captureQueue = Promise.resolve();
    const captureShot = (params) => {
      const shot = captureQueue.then(() => cdp.send('Page.captureScreenshot', params));
      captureQueue = shot.catch(() => {});
      return shot;
    };
    if (mode === 'rec') {
      capturing = true;
      const framesDir = path.join(dir, 'frames');
      if (fs.existsSync(framesDir) && fs.readdirSync(framesDir).length) throw new Error(`${framesDir} already holds frames; move it aside first`);
      fs.mkdirSync(framesDir, { recursive: true });
      capture = (async () => {
        for (let i = 0; capturing;) {
          const t = Date.now() / 1000;
          try {
            const { data } = await captureShot({ format: 'png', optimizeForSpeed: true, clip });
            const file = `f${String(i++).padStart(5, '0')}.png`;
            fs.writeFileSync(path.join(framesDir, file), Buffer.from(data, 'base64'));
            timeline.frames.push({ file, t });
          } catch (e) {
            // Mid-navigation there is no frame to capture; the next one follows.
            captureErrors++;
            await sleep(30);
          }
        }
      })();
    }

    const demo = (fn, ...args) => page.evaluate(([name, a]) => window.__demo[name](...a), [fn, args]);
    let mouse = { x: viewport.width / 2, y: viewport.height / 2 };
    await page.mouse.move(mouse.x, mouse.y);
    // Time-based, so a move takes `ms` of video however slow each input event is.
    const glide = async (x, y, ms) => {
      const from = { ...mouse }, start = Date.now();
      for (;;) {
        const k = Math.min(1, (Date.now() - start) / (ms * time)), e = ease(k);
        await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
        if (k === 1) break;
        await sleep(12);
      }
      mouse = { x, y };
    };
    const center = (selector) => page.evaluate((s) => window.__demo.centerOf(s), selector);
    const glideTo = async (selector, ms, dx = 0, dy = 0) => { const c = await center(selector); await glide(c.x + dx, c.y + dy, ms); };
    const click = async () => { await page.mouse.down(); await sleep(70); await page.mouse.up(); };
    const clickOn = async (selector, ms = 600) => { await glideTo(selector, ms); await click(); };
    const drag = async (dx, dy, ms) => {
      await page.mouse.down();
      await pause(80);
      await glide(mouse.x + dx, mouse.y + dy, ms);
      await pause(60);
      await page.mouse.up();
    };
    // A click on an overlay element (menu row, chat button): the ripple only, nothing underneath is clicked.
    const tapOverlay = async (selector, ms = 500) => { await glideTo(selector, ms); await demo('ripple', mouse.x, mouse.y); await pause(150); };
    // Callouts take `avoid`: the controls the cursor is about to use stay uncovered.
    const say = (id, label, selectors, side, pad, avoid = []) => {
      mark(timeline.says, { id });
      return demo('tip', label, onScreen(id), selectors, side, pad, avoid);
    };
    // Re-anchor the callout: fade out, move while hidden, fade back in.
    const retip = async (id, label, selectors, side, pad, avoid = []) => {
      await demo('tipOff');
      await pause(220);
      await demo('tip', label, onScreen(id), selectors, side, pad, avoid);
    };
    // A new line in a new place: fade the old callout out, then say the next one.
    const sayNext = async (id, label, selectors, side, pad, avoid = []) => {
      await demo('tipOff');
      await pause(220);
      await say(id, label, selectors, side, pad, avoid);
    };
    // Waits until line `id` reaches `word`, so an action lands on the word that names it.
    // Kokoro speaks evenly, so a word's moment is its share of the text.
    const untilWord = async (id, word) => {
      const said = timeline.says.filter(s => s.id === id).pop();
      if (!said) throw new Error(`untilWord: "${id}" has not been said yet`);
      const text = line(id).text, i = text.indexOf(word);
      if (i < 0) throw new Error(`untilWord: "${word}" is not in the ${id} line`);
      const at = said.t * 1000 + (i / text.length) * line(id).dur * 1000 * time;
      if (Date.now() < at) await sleep(at - Date.now());
    };
    // Dropped from the video (a list or grid loading); build.cjs refuses one inside a spoken line.
    const offCamera = async (run) => {
      mark(timeline.cuts, { edge: 'start' });
      await run();
      mark(timeline.cuts, { edge: 'end' });
    };
    const segment = async (id, run) => {
      const start = Date.now();
      mark(timeline.segs, { id });
      await run();
      // Narration often starts partway in (after a click or a load), so the segment
      // lasts until its line, counted from when it was said, has finished.
      const said = timeline.says.filter(s => s.id === id).pop();
      const speechStart = said ? said.t * 1000 : start;
      const minEnd = speechStart + (line(id).dur * 1000 + speechPadMs) * time;
      // minEnd is already in recording time, so this waits in real time (not pause).
      if (Date.now() < minEnd) await sleep(minEnd - Date.now());
      if (mode === 'dry') {
        await sleep(550 * time);   // let spotlight and callout transitions finish before the still
        const stills = path.join(dir, 'dry');
        fs.mkdirSync(stills, { recursive: true });
        await page.screenshot({ path: path.join(stills, `${String(timeline.segs.length).padStart(2, '0')}-${id}.png`), scale: 'css' });
      }
      console.log(`${id.padEnd(12)} ${((Date.now() - start) / 1000 / time).toFixed(2)}s of video  ${page.url()}`);
      if (process.env.STOP_AFTER === id) throw new StopAfter();
    };
    // Waits until an element stops moving (a panel sliding in, a modal growing).
    const settle = async (selector) => {
      let last = '';
      for (let i = 0; i < 40; i++) {
        const box = JSON.stringify(await page.locator(selector).boundingBox());
        if (box === last) return;
        last = box;
        await sleep(60);
      }
      throw new Error(`${selector} kept moving`);
    };
    // Pastes the way a user would: clipboard, then ⌘V into the focused field.
    const paste = async (selector, text) => {
      await page.evaluate((v) => navigator.clipboard.writeText(v), text);
      await demo('key', '⌘ V');
      await page.keyboard.press('Meta+V');
      await pause(400);
      await demo('key', null);
      if (!(await page.inputValue(selector)).trim()) {
        console.log(`  ⌘V did not reach ${selector}; filling it instead`);
        await page.fill(selector, text);
      }
    };
    const typeInto = async (selector, text, delayMs = 18) => { await clickOn(selector, 450); await page.keyboard.type(text, { delay: delayMs * time }); };
    // Wheels a scrolling container until `target` sits `offset` px below its top.
    const wheelTo = async (container, target, offset = 10) => {
      await glideTo(container, 350);
      const dy = await page.evaluate(([c, t, off]) => {
        const box = document.querySelector(c), el = document.querySelector(t);
        if (!box || !el) throw new Error(`wheelTo: no ${box ? t : c}`);
        return el.getBoundingClientRect().top - box.getBoundingClientRect().top - off;
      }, [container, target, offset]);
      const steps = Math.max(1, Math.ceil(Math.abs(dy) / 120));
      for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, dy / steps); await pause(28); }
      await pause(200);
    };
    // A native <select>'s popup never shows in screenshots, so the overlay menu stands in:
    // point at the select, its options open, the cursor picks one, then the real value is set.
    // No Escape afterwards: in many apps it closes the surrounding modal.
    const pickOption = async (selector, value) => {
      await glideTo(selector, 550);
      await demo('ripple', mouse.x, mouse.y);
      const opts = await page.$$eval(`${selector} option`, os => os.map(o => ({ value: o.value, text: o.textContent.trim() })));
      const current = await page.$eval(selector, el => el.value);
      const target = opts.findIndex(o => o.value === value);
      if (target < 0) throw new Error(`${selector} has no option "${value}"; it has ${opts.map(o => o.value).join(', ')}`);
      await demo('menu', selector, opts.map(o => o.text), opts.findIndex(o => o.value === current));
      await pause(450);
      await glideTo(`#demo-menu-${target}`, 600);
      await demo('menuHighlight', target);
      await pause(250);
      await demo('ripple', mouse.x, mouse.y);
      await pause(150);
      await demo('menuOff');
      await page.selectOption(selector, value);
    };
    // After a navigation: the new document has the overlay again, but at full animation speed.
    const navigated = async () => {
      await page.waitForFunction(() => window.__demo, null, { timeout: 30000 });
      await slowMotion();
      await page.mouse.move(mouse.x, mouse.y);
    };
    // The opening: a browser window, `address` typed into its bar, the page shown inside
    // with the address ringed while line `id` plays, then zoomed to full screen on `zoomAtWord`.
    const intro = async ({ id, label = '', address, zoomAtWord, afterZoom }) => {
      if (timeline.segs.length) throw new Error('intro() must come before any other segment');
      // The page's picture for the zoom: the mouse off the content so no hover readout is
      // baked in, the overlay hidden, and Chrome's own capture (Playwright's page.screenshot
      // re-sets the device emulation, and the frame loop would inherit the wrong scale).
      await page.mouse.move(viewport.width / 2, 4);
      await sleep(300);
      await demo('hideLayer', true);
      const shot = 'data:image/jpeg;base64,' + (await captureShot({ format: 'jpeg', quality: 95, clip })).data;
      await demo('hideLayer', false);
      await demo('browserShow');
      mouse = { x: viewport.width / 2, y: viewport.height * 0.58 };
      await page.mouse.move(mouse.x, mouse.y);
      await sleep(800);   // the video's lead-in frames then show the window, not the page behind it
      await segment(id, async () => {
        await pause(500);
        await glideTo('#demo-browser .url', 800);
        await demo('ripple', mouse.x, mouse.y);
        await pause(250);
        await demo('browserType', address, 1300);
        await pause(1450);
        await demo('key', '↵ Enter');
        await pause(450);
        await demo('key', null);
        await demo('browserLoad', shot);
        await pause(400);
        await demo('spot', ['#demo-browser .url'], 6);
        await say(id, label, ['#demo-browser .url'], 'bottom', 6, ['#demo-browser .url']);
        await glide(viewport.width * 0.6, viewport.height * 0.65, 900);
        await untilWord(id, zoomAtWord);
        await demo('spotOff');
        await demo('browserZoom');
        await pause(950);
        await demo('browserHide');
        await pause(350);
        if (afterZoom) await afterZoom();
      });
    };
    // The illustrative AI chat round trip. Label it as an AI chat; it is not any real service's screen.
    const chat = {
      open: async () => { await demo('chatOpen'); await pause(500); },
      // ⌘V into the chat: shows the start of whatever the app put on the clipboard.
      pastePrompt: async () => {
        await tapOverlay('#demo-chat .input', 550);
        await demo('key', '⌘ V');
        const prompt = await page.evaluate(() => navigator.clipboard.readText());
        await demo('chatType', prompt.replace(/\s+/g, ' ').slice(0, 90) + '…');
        await pause(350);
        await demo('key', null);
        return prompt;
      },
      send: async (prompt, reply, { ms = 3000, note = 'Here you go:', lang = 'javascript' } = {}) => {
        await tapOverlay('#demo-chat-send', 450);
        await demo('chatSend', prompt, reply, ms, note, lang);
      },
      waitWritten: () => page.waitForFunction(() => window.__demoChatDone, null, { timeout: 60000 }),
      copy: async (reply) => {
        await tapOverlay('#demo-chat-copy', 500);
        await page.evaluate((v) => navigator.clipboard.writeText(v), reply);
        await demo('chatCopied');
      },
      close: () => demo('chatClose'),
    };

    const t = {
      page, context, cdp, mode, time, viewport, sleep, pause,
      demo, spot: (sel, pad = 8) => demo('spot', sel, pad), spotOff: () => demo('spotOff'), tipOff: () => demo('tipOff'),
      keycap: (text) => demo('key', text),
      get mouse() { return { ...mouse }; },
      glide, glideTo, center, click, clickOn, drag, tapOverlay, typeInto, paste, wheelTo, pickOption, settle,
      say, retip, sayNext, untilWord, offCamera, segment, navigated, intro, chat,
    };
    try {
      await tour(t);
    } catch (e) {
      if (!(e instanceof StopAfter)) throw e;
    }
    mark(timeline.segs, { id: 'end' });
    finished = true;
  } finally {
    capturing = false;
    await capture;
    if (finished && mode === 'rec') {
      fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(timeline, null, 1));
      const secs = timeline.frames.length > 1 ? timeline.frames[timeline.frames.length - 1].t - timeline.frames[0].t : 0;
      console.log(`frames ${timeline.frames.length} (${secs ? (timeline.frames.length / secs * time).toFixed(1) : 0} fps of video), skipped captures ${captureErrors}`);
    }
    await browser.close();
  }
}

module.exports = { record };
