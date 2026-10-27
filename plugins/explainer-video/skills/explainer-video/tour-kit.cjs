// Records a narrated, cursor-driven tour of a web app at 1920x1080. A project's tour
// script calls record() with its own segments; voice.cjs must have voiced the
// narration first, and build.cjs turns the recording into the video.
//
//   NODE_PATH="$(npm root -g)" node tour.cjs <videoDir> dry   a still per segment, and dry/steps.json for guide.cjs
//   NODE_PATH="$(npm root -g)" node tour.cjs <videoDir> rec   frames + timeline.json for build.cjs
//   STOP_AFTER=<segment id> ...                               end a take early; rec still writes it
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ease = (k) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
const linear = (k) => k;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
class StopAfter extends Error {}

// Runs the page's JavaScript clocks at 1/time speed, as Animation.setPlaybackRate does for
// CSS: performance.now, Date.now and timer delays. Without it, D3 transitions, count-ups
// and anything else timed from performance.now or Date.now play `time` times too fast in
// the video. Frame callbacks get the slowed performance.now: the timestamp Chrome passes
// them follows the document timeline, which setPlaybackRate slows on its own, so it lags
// performance.now by more every second. Also pins devicePixelRatio: Chrome's clip capture
// drops it to 1 after the first frame, and a canvas redrawn after that comes out soft.
function slowPageClock(time, ratio) {
  const k = 1 / time;
  const perfNow = performance.now.bind(performance), t0 = perfNow();
  performance.now = () => t0 + (perfNow() - t0) * k;
  const dateNow = Date.now, d0 = dateNow();
  Date.now = () => Math.round(d0 + (dateNow() - d0) * k);
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(performance.now()));
  const setTimeoutReal = window.setTimeout.bind(window), setIntervalReal = window.setInterval.bind(window);
  window.setTimeout = (fn, ms = 0, ...args) => setTimeoutReal(fn, ms * time, ...args);
  window.setInterval = (fn, ms = 0, ...args) => setIntervalReal(fn, ms * time, ...args);
  Object.defineProperty(window, 'devicePixelRatio', { get: () => ratio, configurable: true });
}

// Everything drawn on top of the app, inside a shadow root so the app's CSS (a `.user` or
// `.note` rule) cannot restyle it. Two layers:
//  - the page layer moves with the camera: cursor, ripples, spotlight, focus blur, ink,
//    callouts, the before/after still, the select menu, the illustrative AI chat, the
//    browser window of the intro;
//  - the screen layer (#demo-hud) is counter-scaled to the camera every frame, so it stays
//    put on screen: chapter chip, speed badge, lower third, stat card, scenes and cards.
// Installed on every page load; all of it ignores the mouse, so the app gets every real click.
function installOverlay() {
  const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">${body}</svg>`;
  const url = (s) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  const arrowPath = 'M3 2 L3 22 L8.2 17.2 L11.8 25 L15.2 23.5 L11.7 15.9 L18.6 15.9 Z';
  // Each cursor shape and the point of it that clicks.
  const cursors = {
    arrow: { img: svg(`<path d="${arrowPath}" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/>`), hot: [3, 2] },
    hand: { img: svg('<path d="M10 3.5c0-1.1.9-2 2-2s2 .9 2 2V12l.2-.1c.9-.4 2 0 2.4.9l.1.2.2-.1c.9-.4 2 0 2.4.9l.1.3.3-.1c.9-.3 1.9.2 2.2 1.1.1.2.1.4.1.6v4.5c0 3.6-2.9 6.5-6.5 6.5h-1.6c-2.2 0-4.2-1.2-5.3-3.1L5.2 17c-.6-1-.3-2.2.6-2.8.9-.6 2-.4 2.7.4l1.5 1.8V3.5z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/><path d="M14 12v4.6M16.7 13v3.8M19.4 14v3.4" stroke="#111" stroke-width="1.2" stroke-linecap="round"/>'), hot: [12, 2] },
    text: { img: svg(['#111', '#fff'].map((c, i) => `<path d="M10 4.5h2.5L14 6l1.5-1.5H18M14 6v16M10 23.5h2.5L14 22l1.5 1.5H18" fill="none" stroke="${c}" stroke-width="${i ? 1.6 : 3.4}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')), hot: [14, 14] },
    grabbing: { img: svg('<path d="M7.5 14.5c0-1.4 1.1-2.5 2.5-2.5.3-1 1.2-1.6 2.2-1.6s1.8.6 2.1 1.4c.4-.8 1.2-1.3 2.1-1.3 1 0 1.8.6 2.1 1.5.3-.2.7-.3 1.1-.3 1.3 0 2.4 1.1 2.4 2.4v4.4c0 3.5-2.8 6.3-6.3 6.3h-1.4c-3.6 0-6.8-2.6-6.8-6.2z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>'), hot: [14, 14] },
    touch: { hot: [17, 17] },
  };
  const lock = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="#6b6f86"/><path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="#6b6f86" stroke-width="1.5"/></svg>`;
  const ink = '#23234f', accent = '#8676ff', accentDeep = '#c64eff', marker = '#ff5c39';
  const font = "'Open Sans', system-ui, sans-serif", mono = "'JetBrains Mono', ui-monospace, monospace";
  const move = 'cubic-bezier(.4,0,.2,1)', pop = 'cubic-bezier(.34,1.56,.64,1)';
  const css = `
    #demo-layer, #demo-layer * { pointer-events: none !important; }
    #demo-layer { position: fixed; inset: 0; }
    #demo-spot { position: fixed; border-radius: 14px; opacity: 0;
      box-shadow: 0 0 0 3px ${accent}, 0 0 0 9999px rgba(30, 26, 70, .30);
      transition: left .5s ${move}, top .5s ${move}, width .5s ${move}, height .5s ${move}, opacity .35s; }
    #demo-focus { position: fixed; inset: 0; opacity: 0; transition: opacity .45s;
      background: rgba(35, 35, 79, .10); backdrop-filter: blur(3px) grayscale(.9); }
    #demo-focus.on { opacity: 1; }
    #demo-before { position: fixed; left: 0; top: 0; display: none; }
    #demo-before.on { display: block; }
    #demo-wipe { position: fixed; top: 0; bottom: 0; left: 0; width: 3px; margin-left: -1.5px; background: #fff; display: none;
      box-shadow: 0 0 0 1px rgba(20, 16, 60, .25), 0 0 18px rgba(20, 16, 60, .35); }
    #demo-wipe.on { display: block; }
    #demo-wipe b { position: absolute; top: 24px; padding: 4px 11px; border-radius: 999px; background: ${ink}; color: #fff;
      font: 700 13px/1.4 ${font}; white-space: nowrap; }
    #demo-wipe b:first-child { right: 12px; } #demo-wipe b:last-child { left: 12px; }
    svg.demo-ink { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; }
    #demo-ink { position: fixed; }
    svg.demo-ink path { fill: none; stroke: ${marker}; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
    svg.demo-ink path.marker { stroke: rgba(255, 214, 10, .42); stroke-linecap: butt; }
    svg.demo-ink path.strike { stroke-width: 4; }
    @keyframes demo-draw { to { stroke-dashoffset: 0; } }
    .demo-mark { position: fixed; }
    .demo-pulse b { position: absolute; left: -8px; top: -8px; width: 16px; height: 16px; border-radius: 50%; box-sizing: border-box;
      background: ${marker}; border: 3px solid #fff; animation: demo-pop .4s ${pop} both; }
    .demo-pulse i { position: absolute; left: -9px; top: -9px; width: 18px; height: 18px; border-radius: 50%; box-sizing: border-box;
      border: 3px solid ${marker}; opacity: 0; animation: demo-ping 1.3s cubic-bezier(.2,.6,.3,1) 3; }
    .demo-pulse i + i { animation-delay: .45s; }
    @keyframes demo-ping { from { transform: scale(.7); opacity: .95 } to { transform: scale(3.6); opacity: 0 } }
    @keyframes demo-pop { from { transform: scale(0) } }
    .demo-badge { width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; display: grid; place-items: center;
      background: ${marker}; color: #fff; font: 800 15px/1 ${font};
      box-shadow: 0 0 0 3px #fff, 0 6px 16px rgba(255, 92, 57, .4); animation: demo-pop .45s ${pop} both; }
    .demo-note { padding: 7px 13px; border-radius: 10px; background: #fff; color: ${ink}; border: 2px solid ${marker};
      font: 700 15px/1.2 ${font}; white-space: nowrap; box-shadow: 0 8px 20px rgba(20, 16, 60, .18);
      animation: demo-rise .35s ${move} both; }
    @keyframes demo-rise { from { opacity: 0; transform: translateY(8px) } }
    .demo-ghost { position: fixed; left: 0; top: 0; transition: opacity .3s; }
    .demo-ghost svg { position: absolute; left: -3px; top: -2px; filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .3)); }
    .demo-ghost span { position: absolute; left: 18px; top: 22px; padding: 2px 8px; border-radius: 6px; background: var(--c);
      color: #fff; font: 700 12px/1.5 ${font}; white-space: nowrap; }
    #demo-tip { position: fixed; max-width: 330px; padding: 12px 16px 14px; border-radius: 12px;
      background: ${ink}; color: #fff; font: 600 17px/1.38 ${font};
      box-shadow: 0 14px 34px rgba(20, 16, 60, .35); opacity: 0; transform: translateY(8px);
      transition: opacity .28s, transform .28s ${move}; }
    #demo-tip.on { opacity: 1; transform: none; }
    #demo-tip .lab { display: inline-block; margin-bottom: 7px; padding: 1px 9px; border-radius: 999px;
      background: linear-gradient(90deg, ${accent}, ${accentDeep});
      font: 700 11px/1.7 ${font}; letter-spacing: .08em; text-transform: uppercase; }
    #demo-tip .txt { display: block; }
    #demo-tip.big { max-width: none; padding: 18px 28px; text-align: center; font-size: 26px; }
    #demo-tip.compact { padding: 9px 15px; font-size: 16px; }
    #demo-tip.compact .lab { display: none !important; }
    #demo-tip.compact .txt::before { content: ''; display: inline-block; width: 9px; height: 9px; margin-right: 9px; border-radius: 50%;
      background: linear-gradient(90deg, ${accent}, ${accentDeep}); vertical-align: 1px; }
    #demo-cursor { position: fixed; left: 0; top: 0; width: 28px; height: 28px; filter: drop-shadow(0 2px 3px rgba(0, 0, 0, .35)); transition: opacity .3s; }
    #demo-cursor i { position: absolute; left: 0; top: 0; width: 28px; height: 28px; background: ${url(cursors.arrow.img)} no-repeat;
      transform-origin: 3px 2px; transition: transform .12s; }
    ${['hand', 'text', 'grabbing'].map(k => `#demo-cursor[data-kind="${k}"] i { background-image: ${url(cursors[k].img)}; transform-origin: ${cursors[k].hot[0]}px ${cursors[k].hot[1]}px; }`).join('\n')}
    #demo-cursor[data-kind="touch"] i { width: 34px; height: 34px; box-sizing: border-box; border-radius: 50%; background: rgba(35, 35, 79, .32);
      border: 3px solid #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, .3); transform-origin: 17px 17px; }
    #demo-cursor.down i { transform: scale(.82); }
    .demo-ripple { position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
      border: 3px solid var(--c, ${accent}); background: rgba(134, 118, 255, .18);
      animation: demo-ripple .55s ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.2); opacity: 1 } to { transform: scale(1.35); opacity: 0 } }
    #demo-key { position: fixed; padding: 3px 9px; border-radius: 7px; background: #fff; color: ${ink};
      border: 1px solid #c5c1ec; box-shadow: 0 2px 0 #c5c1ec; font: 700 13px/1.4 ${font};
      white-space: nowrap; opacity: 0; transition: opacity .2s; }
    #demo-layer.covered #demo-cursor, #demo-layer.covered #demo-key { opacity: 0 !important; }
    #demo-menu { position: fixed; min-width: 200px; padding: 5px; border-radius: 10px; background: #fff;
      border: 1px solid #dbdff1; box-shadow: 0 12px 30px rgba(20, 16, 60, .22); font: 500 13px/1.3 ${font};
      color: ${ink}; opacity: 0; transform: translateY(-4px); transition: opacity .18s, transform .18s; }
    #demo-menu.on { opacity: 1; transform: none; }
    #demo-menu .row { padding: 7px 10px; border-radius: 6px; white-space: nowrap; }
    #demo-menu .row.cur { font-weight: 700; } #demo-menu .row.hl { background: #eeebff; color: #5b4bd6; }
    #demo-chat { position: fixed; right: 26px; top: 64px; width: 540px; height: 600px; border-radius: 14px; background: #fff;
      box-shadow: 0 24px 60px rgba(15, 12, 45, .45); display: flex; flex-direction: column; overflow: hidden;
      font: 400 13px/1.45 ${font}; color: #1f2333; transform: translateX(120%); transition: transform .45s ${move}; }
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
    #demo-chat .code pre { margin: 0; padding: 10px 12px; flex: 1; overflow: hidden; color: #d9dcf2; font: 11px/1.5 ${mono}; white-space: pre-wrap; }
    #demo-chat .input { display: flex; align-items: center; gap: 10px; margin: 12px 16px 16px; padding: 11px 14px; border: 1px solid #dfe2ee; border-radius: 12px; color: #9aa0b8; }
    #demo-chat .input .txt { flex: 1; color: #1f2333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #demo-chat-send { width: 28px; height: 28px; border-radius: 50%; background: ${accent}; color: #fff; display: grid; place-items: center; font-size: 13px; }
    #demo-browser { position: fixed; inset: 0; background: #e9ebf2; display: none; opacity: 0; transition: opacity .35s; }
    #demo-browser.on { display: block; opacity: 1; }
    #demo-browser .bar { position: absolute; left: 0; right: 0; top: 0; height: 56px; display: flex; align-items: center; gap: 8px;
      padding: 0 18px; background: #e9ebf2; border-bottom: 1px solid #d9dce6; z-index: 1; transition: transform .6s ${move}; }
    #demo-browser .bar i { width: 12px; height: 12px; border-radius: 50%; background: #c9ccd8; }
    #demo-browser .url { margin-left: 18px; width: 640px; height: 34px; display: flex; align-items: center; gap: 9px; padding: 0 14px;
      border-radius: 17px; background: #fff; border: 1px solid #d5d8e3; font: 500 16px ${font}; color: ${ink}; }
    #demo-browser .url .lock { width: 14px; height: 14px; flex: none; background: url("data:image/svg+xml,${encodeURIComponent(lock)}") no-repeat center; }
    #demo-browser .url .caret { width: 1.5px; height: 18px; background: ${ink}; animation: demo-blink 1s steps(1) infinite; }
    @keyframes demo-blink { 50% { opacity: 0; } }
    #demo-browser .page { position: absolute; left: 0; right: 0; top: 57px; bottom: 0; background: #fff; transition: opacity .3s; }
    #demo-browser .shot { position: fixed; left: 0; top: 0; transform-origin: 0 0; opacity: 0; transition: transform .9s ${move}, opacity .35s; }
    #demo-browser.loaded .shot { opacity: 1; }
    #demo-browser.zoom .bar { transform: translateY(-100%); }
    #demo-browser.zoom .page { opacity: 0; }
    #demo-browser.zoom .shot { transform: none !important; }
    #demo-hud { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; transform-origin: 0 0; font-family: ${font}; }
    #demo-chip { position: absolute; left: 18px; top: 14px; padding: 6px 13px; border-radius: 999px; background: rgba(35, 35, 79, .9); color: #fff;
      font: 700 13px/1.4 ${font}; opacity: 0; transform: translateY(-6px); transition: opacity .3s, transform .3s ${move}; }
    #demo-chip.on { opacity: 1; transform: none; }
    #demo-chip b { margin-right: 9px; color: #c9c3ff; font-weight: 800; }
    #demo-speed { position: absolute; right: 18px; top: 14px; padding: 5px 12px; border-radius: 10px; background: ${marker}; color: #fff;
      font: 800 17px/1.3 ${font}; opacity: 0; transition: opacity .25s; }
    #demo-speed.on { opacity: 1; }
    #demo-lower { position: absolute; left: 32px; bottom: 120px; display: flex; flex-direction: column; gap: 2px; padding: 11px 18px 12px 20px;
      border-radius: 12px; background: rgba(35, 35, 79, .94); color: #fff; box-shadow: 0 14px 34px rgba(20, 16, 60, .35);
      border-left: 5px solid ${accent}; opacity: 0; transform: translateX(-24px); transition: opacity .35s, transform .45s ${move}; }
    #demo-lower.on { opacity: 1; transform: none; }
    #demo-lower b { font: 800 20px/1.25 ${font}; } #demo-lower span { font: 500 14px/1.4 ${font}; color: #c9c3ff; }
    #demo-stat { position: absolute; min-width: 190px; padding: 14px 20px 16px; border-radius: 14px; background: #fff; color: ${ink};
      box-shadow: 0 14px 34px rgba(20, 16, 60, .28); opacity: 0; transform: translateY(10px); transition: opacity .3s, transform .35s ${move}; }
    #demo-stat.on { opacity: 1; transform: none; }
    #demo-stat small { display: block; font: 700 12px/1.5 ${font}; letter-spacing: .06em; text-transform: uppercase; color: #6b6f86; }
    #demo-stat b { display: block; margin-top: 2px; font: 800 40px/1.1 ${font}; font-variant-numeric: tabular-nums; }
    #demo-scene, #demo-card { position: absolute; inset: 0; color: #fff; background: radial-gradient(circle at 30% 18%, #3d3b93, ${ink} 62%); }
    #demo-scene { display: grid; place-items: center; opacity: 0; transition: opacity .45s; }
    #demo-scene.on { opacity: 1; }
    #demo-scene .rise, #demo-card .rise { opacity: 0; transform: translateY(26px); animation: demo-word .6s ${move} forwards; }
    @keyframes demo-word { to { opacity: 1; transform: none; } }
    #demo-scene h2 { margin: 0 0 34px; font: 800 38px/1.2 ${font}; text-align: center; }
    #demo-scene .flow { position: relative; }
    #demo-scene .flow-row { display: flex; align-items: center; gap: 70px; }
    #demo-scene .flow-box { display: flex; align-items: center; gap: 12px; padding: 18px 22px; border-radius: 16px; background: #fff; color: ${ink};
      font: 700 19px/1.3 ${font}; box-shadow: 0 16px 36px rgba(0, 0, 0, .28); }
    #demo-scene .flow-box b { width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center; background: ${marker}; color: #fff; font: 800 15px ${font}; }
    #demo-scene svg.demo-ink path.connector { stroke: #fff; }
    #demo-scene .win { width: min(880px, 82vw); border-radius: 14px; overflow: hidden; background: #171925; box-shadow: 0 28px 70px rgba(0, 0, 0, .45); }
    #demo-scene .win-hd { display: flex; align-items: center; gap: 7px; padding: 11px 14px; background: #24273a; color: #aeb3cf; font: 600 13px ${font}; }
    #demo-scene .win-hd i { width: 11px; height: 11px; border-radius: 50%; background: #3b3f55; }
    #demo-scene .win-hd span { margin-left: 8px; }
    #demo-scene pre { margin: 0; padding: 18px 20px 22px; min-height: 220px; font: 15px/1.65 ${mono}; color: #e3e6f7; white-space: pre-wrap; }
    #demo-scene .cmd b { color: #8bd5a0; font-weight: 700; } #demo-scene .out { color: #9aa0bd; }
    #demo-scene .ln { position: relative; padding-left: 44px; } #demo-scene .ln i { position: absolute; left: 0; width: 30px; text-align: right; color: #5b6080; font-style: normal; }
    #demo-scene .ln.hl::before { content: ''; position: absolute; left: -20px; top: 0; bottom: 0; width: 0; background: rgba(134, 118, 255, .28); transition: width .6s ${move}; }
    #demo-scene .swept .ln.hl::before { width: calc(100% + 40px); }
    #demo-card { display: grid; place-content: center; justify-items: center; gap: 16px; text-align: center;
      clip-path: circle(0% at 50% 50%); transition: clip-path .9s ${move}; }
    #demo-card.on { clip-path: circle(75% at 50% 50%); }
    #demo-card .logo { width: 84px; height: 84px; border-radius: 22px; display: grid; place-items: center;
      background: linear-gradient(135deg, ${accent}, ${accentDeep}); box-shadow: 0 18px 40px rgba(0, 0, 0, .3); animation: demo-pop .55s .35s ${pop} both; }
    #demo-card .kicker { font: 700 15px/1.4 ${font}; letter-spacing: .12em; text-transform: uppercase; color: #c9c3ff; }
    #demo-card h1 { margin: 0; font: 800 62px/1.1 ${font}; letter-spacing: -.02em; }
    #demo-card h1 span, #demo-card p, #demo-card .kicker { display: inline-block; }
    #demo-card p { margin: 0; font: 600 26px ${font}; color: #cdc8ff; }
    #demo-card ol { margin: 10px 0 0; padding: 0; list-style: none; display: grid; gap: 12px; text-align: left; }
    #demo-card li { display: flex; align-items: center; gap: 14px; font: 600 25px/1.3 ${font}; color: #ecebff; }
    #demo-card li b, #demo-card figcaption b { flex: none; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: ${marker}; color: #fff; font: 800 17px ${font}; }
    #demo-card .steps { display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 20px; width: min(1120px, 88vw); margin-top: 8px; }
    #demo-card figure { margin: 0; } #demo-card figure img { display: block; width: 100%; border-radius: 10px; box-shadow: 0 14px 30px rgba(0, 0, 0, .35); }
    #demo-card figcaption { display: flex; align-items: center; gap: 10px; margin-top: 10px; font: 600 17px/1.3 ${font}; text-align: left; }
    #demo-card figcaption b { width: 28px; height: 28px; font-size: 14px; }
  `;
  const host = document.createElement('div');
  host.id = 'demo-host';
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${css}</style><div id="demo-layer">`
    + '<div id="demo-browser"><div class="bar"><i></i><i></i><i></i><div class="url"><span class="lock"></span><span class="txt"></span><span class="caret"></span></div></div><div class="page"></div><img class="shot" alt=""></div>'
    + '<img id="demo-before" alt=""><div id="demo-wipe"><b></b><b></b></div>'
    + '<div id="demo-focus"></div><div id="demo-spot"></div><svg id="demo-ink" class="demo-ink"></svg><div id="demo-marks"></div><div id="demo-ghosts"></div><div id="demo-menu"></div>'
    + '<div id="demo-chat"><div class="hd"><i></i><i></i><i></i><b>AI chat</b></div><div class="msgs"></div>'
    + '<div class="input"><span class="txt">Message the AI…</span><span id="demo-chat-send">➤</span></div></div>'
    + '<div id="demo-tip"><span class="lab"></span><span class="txt"></span></div>'
    + '<div id="demo-hud"><div id="demo-chip"></div><div id="demo-speed"></div><div id="demo-lower"></div><div id="demo-stat"></div><div id="demo-scene"></div><div id="demo-card"></div></div>'
    + '<div id="demo-key"></div><div id="demo-cursor"><i></i></div></div>';
  const $ = (id) => root.getElementById(id);
  const layer = $('demo-layer'), cursor = $('demo-cursor'), key = $('demo-key'), spot = $('demo-spot'), tip = $('demo-tip');
  const menu = $('demo-menu'), chat = $('demo-chat'), browser = $('demo-browser'), focusLayer = $('demo-focus');
  const inkLayer = $('demo-ink'), marks = $('demo-marks'), ghosts = $('demo-ghosts'), beforeImg = $('demo-before'), wipeBar = $('demo-wipe');
  const hud = $('demo-hud'), chip = $('demo-chip'), speedBadge = $('demo-speed'), lower = $('demo-lower'), stat = $('demo-stat');
  const scene = $('demo-scene'), card = $('demo-card');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const wait = (ms) => new Promise(r => setTimeout(r, ms * window.__DEMO_TIME));
  // Overlay elements are found in the shadow root, app elements in the page, and a scene's
  // own elements (a flowchart box) in the scene when the page has no match.
  const find = (sel) => sel.startsWith('#demo-') ? root.querySelector(sel) : (document.querySelector(sel) || scene.querySelector(sel));

  const at = { x: -50, y: -50 };
  let cursorOverride = null;
  // The cursor takes the shape a real one would: a hand over what the app marks clickable,
  // an I-beam over text fields; a touch circle all the time in a phone take.
  const kindAt = (x, y) => {
    if (window.__DEMO_POINTER === 'touch') return 'touch';
    if (cursorOverride) return cursorOverride;
    const under = browser.classList.contains('on') ? null : document.elementFromPoint(x, y);
    const shape = under ? getComputedStyle(under).cursor : 'auto';
    return { pointer: 'hand', text: 'text', grab: 'grabbing', grabbing: 'grabbing' }[shape] || 'arrow';
  };
  const placeCursor = () => {
    cursor.dataset.kind = kindAt(at.x, at.y);
    const [hx, hy] = cursors[cursor.dataset.kind].hot;
    cursor.style.transform = `translate(${at.x - hx}px, ${at.y - hy}px)`;
    key.style.transform = `translate(${at.x + 22}px, ${at.y + 18}px)`;
  };
  window.addEventListener('mousemove', (e) => { at.x = e.clientX; at.y = e.clientY; placeCursor(); }, true);
  const rippleAt = (x, y, color) => {
    const ripple = document.createElement('div');
    ripple.className = 'demo-ripple';
    Object.assign(ripple.style, { left: x + 'px', top: y + 'px' });
    if (color) ripple.style.setProperty('--c', color);
    layer.insertBefore(ripple, cursor);
    setTimeout(() => ripple.remove(), 600 * window.__DEMO_TIME);
  };
  window.addEventListener('mousedown', (e) => { rippleAt(e.clientX, e.clientY); cursor.classList.add('down'); }, true);
  window.addEventListener('mouseup', () => cursor.classList.remove('down'), true);

  const rectOf = (selectors, pad) => {
    const rects = selectors.map(find).filter(Boolean).map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
    if (!rects.length) throw new Error('demo: nothing visible for ' + selectors.join(', '));
    const left = Math.min(...rects.map(r => r.left)) - pad, top = Math.min(...rects.map(r => r.top)) - pad;
    const right = Math.max(...rects.map(r => r.right)) + pad, bottom = Math.max(...rects.map(r => r.bottom)) + pad;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };
  // While following, a target can vanish for a moment (a re-render); keep the last place then.
  const rectOfOrNull = (selectors, pad) => { try { return rectOf(selectors, pad); } catch (e) { return null; } };
  const centerOfRect = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });
  // A scene element's box in the scene's own layout, ignoring transforms (its rise-in
  // animation, the screen layer's counter-scale): where it will be once it has settled.
  const settledRect = (el) => {
    let left = 0, top = 0;
    for (let n = el; n && n !== scene; n = n.offsetParent) { left += n.offsetLeft; top += n.offsetTop; }
    return { left, top, width: el.offsetWidth, height: el.offsetHeight, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
  };
  let spotTarget = null, spotSettle = null, focusTarget = null, chipTimer = null, dimmed = [];

  // Ink is drawn on, stroke by stroke: each path's dash is its own length, and a CSS
  // animation runs the offset to 0 (CSS, so the half-speed take slows it like the page).
  const SVG = 'http://www.w3.org/2000/svg';
  const f = (n) => n.toFixed(1);
  const drawOn = (d, ms, delay = 0, { into = inkLayer, className = '', width } = {}) => {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    if (className) p.setAttribute('class', className);
    if (width) p.style.strokeWidth = width + 'px';
    into.appendChild(p);
    const length = p.getTotalLength();
    Object.assign(p.style, { strokeDasharray: length, strokeDashoffset: length, animation: `demo-draw ${ms}ms cubic-bezier(.6,0,.3,1) ${delay}ms forwards` });
    return p;
  };
  // A path through points, smoothed with quadratic curves between their midpoints.
  const smooth = (pts) => {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x, y] = pts[i], [nx, ny] = pts[i + 1];
      d += ` Q${f(x)} ${f(y)} ${f((x + nx) / 2)} ${f((y + ny) / 2)}`;
    }
    const [lx, ly] = pts[pts.length - 1];
    return d + ` L${f(lx)} ${f(ly)}`;
  };
  // The shapes, around a padded box r. The circle is a hand-drawn loop: a little more than
  // one turn, slightly uneven, ending outside where it began. A marker is a translucent
  // stroke as tall as the text; a strike runs through its middle.
  const shapes = {
    circle: (r) => {
      const c = centerOfRect(r), rx = r.width / 2, ry = r.height / 2;
      return { d: smooth(Array.from({ length: 65 }, (_, i) => {
        const k = i / 64, a = Math.PI * 0.92 + k * 1.12 * 2 * Math.PI, wobble = 1 + 0.035 * Math.sin(k * 9) + 0.06 * k;
        return [c.x + Math.cos(a) * rx * wobble, c.y + Math.sin(a) * ry * wobble];
      })) };
    },
    underline: (r) => ({ d: `M${f(r.left)} ${f(r.bottom + 1)} Q${f((r.left + r.right) / 2)} ${f(r.bottom + 6)} ${f(r.right + 4)} ${f(r.bottom - 2)}` }),
    box: (r) => {
      const k = 10;
      return { d: `M${f(r.left + k)} ${f(r.top)}H${f(r.right - k)}Q${f(r.right)} ${f(r.top)} ${f(r.right)} ${f(r.top + k)}V${f(r.bottom - k)}`
        + `Q${f(r.right)} ${f(r.bottom)} ${f(r.right - k)} ${f(r.bottom)}H${f(r.left + k)}Q${f(r.left)} ${f(r.bottom)} ${f(r.left)} ${f(r.bottom - k)}`
        + `V${f(r.top + k)}Q${f(r.left)} ${f(r.top)} ${f(r.left + k + 14)} ${f(r.top - 1)}` };
    },
    marker: (r) => ({ d: `M${f(r.left)} ${f((r.top + r.bottom) / 2)} L${f(r.right)} ${f((r.top + r.bottom) / 2 - 1)}`, className: 'marker', width: r.height }),
    strike: (r) => ({ d: `M${f(r.left - 2)} ${f((r.top + r.bottom) / 2 + 1)} Q${f((r.left + r.right) / 2)} ${f((r.top + r.bottom) / 2 - 2)} ${f(r.right + 2)} ${f((r.top + r.bottom) / 2)}`, className: 'strike' }),
  };
  // Where the line from a box's centre toward point p leaves the box, plus a gap.
  const edgeToward = (r, p, gap = 6) => {
    const c = centerOfRect(r), dx = p.x - c.x, dy = p.y - c.y;
    const s = Math.min(dx ? (r.width / 2 + gap) / Math.abs(dx) : Infinity, dy ? (r.height / 2 + gap) / Math.abs(dy) : Infinity);
    return { x: c.x + dx * s, y: c.y + dy * s };
  };
  // A bowed arrow from box `from` to point `to`, stopping short of it; the head is drawn after the shaft.
  const drawArrow = (from, to, ms, delay, bend, into = inkLayer, className = '') => {
    const a = edgeToward(from, to), dx = to.x - a.x, dy = to.y - a.y, dist = Math.hypot(dx, dy);
    const b = { x: to.x - dx / dist * 16, y: to.y - dy / dist * 16 };
    const c = { x: (a.x + b.x) / 2 - dy * bend, y: (a.y + b.y) / 2 + dx * bend };
    drawOn(`M${f(a.x)} ${f(a.y)} Q${f(c.x)} ${f(c.y)} ${f(b.x)} ${f(b.y)}`, ms, delay, { into, className });
    const ux = b.x - c.x, uy = b.y - c.y, ul = Math.hypot(ux, uy), hx = ux / ul, hy = uy / ul;
    const wing = (s) => ({ x: b.x - 15 * (hx * Math.cos(s) - hy * Math.sin(s)), y: b.y - 15 * (hy * Math.cos(s) + hx * Math.sin(s)) });
    const l = wing(0.5), rr = wing(-0.5);
    drawOn(`M${f(l.x)} ${f(l.y)} L${f(b.x)} ${f(b.y)} L${f(rr.x)} ${f(rr.y)}`, 180, delay + ms, { into, className });
  };
  const addMark = (className, x, y, into = marks) => {
    const m = document.createElement('div');
    m.className = 'demo-mark ' + className;
    Object.assign(m.style, { left: x + 'px', top: y + 'px' });
    into.appendChild(m);
    return m;
  };
  // The focus layer's clip: the whole viewport minus a rounded hole around the target.
  const holeAround = (r, k = 14) => `path(evenodd, 'M0 0H${innerWidth}V${innerHeight}H0Z M${f(r.left + k)} ${f(r.top)}H${f(r.right - k)}`
    + `A${k} ${k} 0 0 1 ${f(r.right)} ${f(r.top + k)}V${f(r.bottom - k)}A${k} ${k} 0 0 1 ${f(r.right - k)} ${f(r.bottom)}`
    + `H${f(r.left + k)}A${k} ${k} 0 0 1 ${f(r.left)} ${f(r.bottom - k)}V${f(r.top + k)}A${k} ${k} 0 0 1 ${f(r.left + k)} ${f(r.top)}Z')`;
  const cover = (on) => layer.classList.toggle('covered', on);
  // Words, items or steps of a scene or card, each rising in after the one before it.
  const riseDelay = (i, first = 0.45, gap = 0.1) => `animation-delay:${(first + i * gap).toFixed(2)}s`;

  window.__demo = {
    // The padded box around selectors, for the camera to frame.
    box(selectors, pad = 0) { return rectOf(selectors, pad); },
    // Counter-scales the screen layer to the camera, so it stays the same on screen.
    hudCamera(c, viewportWidth) {
      const zoom = viewportWidth / c.w;
      hud.style.transform = zoom === 1 && !c.x && !c.y ? '' : `translate(${c.x}px, ${c.y}px) scale(${1 / zoom})`;
    },
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
    // Blurs and greys out everything but the target, following it every frame.
    focus(selectors, pad = 10) {
      focusTarget = { selectors, pad };
      const follow = () => {
        if (!focusTarget || focusTarget.selectors !== selectors) return;
        const r = rectOfOrNull(selectors, pad);
        if (r) focusLayer.style.clipPath = holeAround(r);
        requestAnimationFrame(follow);
      };
      follow();
      focusLayer.classList.add('on');
    },
    focusOff() { focusTarget = null; focusLayer.classList.remove('on'); },
    // kind: circle | underline | box | marker | strike, drawn on over `ms`. A target inside
    // the current scene is drawn on the scene's own layer, which sits above the page's.
    ink(kind, selectors, pad, ms) {
      if (!shapes[kind]) throw new Error(`demo: no ink "${kind}"; there is ${Object.keys(shapes).join(', ')}`);
      const els = selectors.map(find);
      const inScene = els.length && els.every(el => el && scene.contains(el));
      const r = inScene ? els.map(settledRect).reduce((a, b) => ({ left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) }))
        : rectOf(selectors, pad);
      const box = inScene ? { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad } : r;
      const { d, className, width } = shapes[kind]({ ...box, width: box.right - box.left, height: box.bottom - box.top });
      drawOn(d, ms, 0, { className, width, into: inScene ? scene.querySelector('svg.demo-ink') : inkLayer });
    },
    arrow(fromSelectors, toSelectors, ms, bend) { drawArrow(rectOf(fromSelectors, 0), centerOfRect(rectOf(toSelectors, 0)), ms, 0, bend); },
    // A dot with three rings spreading from it. Three, not endless: flashing cues hurt learning.
    pulse(selectors) {
      const c = centerOfRect(rectOf(selectors, 0));
      addMark('demo-pulse', c.x, c.y).innerHTML = '<i></i><i></i><b></b>';
    },
    // A numbered step marker on the target's top-left corner.
    badge(selectors, n) {
      const r = rectOf(selectors, 0);
      addMark('demo-badge', r.left + 4, r.top - 4).textContent = String(n);
    },
    // A short note `dx, dy` away from the target, with an arrow drawn from it to the target.
    note(selectors, text, dx, dy, ms) {
      const target = centerOfRect(rectOf(selectors, 0));
      const chipEl = addMark('demo-note', 0, 0);
      chipEl.textContent = text;
      const w = chipEl.offsetWidth, h = chipEl.offsetHeight, left = target.x + dx - w / 2, top = target.y + dy - h / 2;
      Object.assign(chipEl.style, { left: left + 'px', top: top + 'px' });
      drawArrow({ left, top, right: left + w, bottom: top + h, width: w, height: h }, target, ms, 250, 0.22);
    },
    // Fades out every mark drawn so far; anything drawn after this call stays.
    inkOff() {
      const old = [...inkLayer.children, ...marks.children];
      old.map(n => { n.style.transition = 'opacity .35s'; n.style.opacity = 0; });
      setTimeout(() => old.map(n => n.remove()), 400 * window.__DEMO_TIME);
    },
    // Fades the matching elements, all but `except`: one chart series kept, the rest dimmed.
    dim(selectors, except, opacity) {
      const keep = new Set(except.flatMap(s => [...document.querySelectorAll(s)]));
      dimmed = selectors.flatMap(s => [...document.querySelectorAll(s)]).filter(el => !keep.has(el))
        .map(el => ({ el, opacity: el.style.opacity, transition: el.style.transition }));
      dimmed.map(({ el }) => Object.assign(el.style, { transition: 'opacity .4s', opacity }));
    },
    undim() {
      dimmed.map(({ el, opacity }) => { el.style.opacity = opacity; });
      const restore = dimmed;
      setTimeout(() => restore.map(({ el, transition }) => { el.style.transition = transition; }), 450 * window.__DEMO_TIME);
      dimmed = [];
    },
    // `n` points along an SVG line or path (in viewport pixels), or across a box at mid-height.
    pointsAlong(selector, from, to, n) {
      const el = find(selector);
      if (!el) throw new Error('demo: no element for ' + selector);
      const share = (i) => from + (to - from) * i / (n - 1);
      if (typeof el.getTotalLength === 'function') {
        const length = el.getTotalLength(), m = el.getScreenCTM();
        return Array.from({ length: n }, (_, i) => {
          const p = el.getPointAtLength(length * share(i)), q = new DOMPoint(p.x, p.y).matrixTransform(m);
          return { x: q.x, y: q.y };
        });
      }
      const r = el.getBoundingClientRect();
      return Array.from({ length: n }, (_, i) => ({ x: r.left + r.width * share(i), y: r.top + r.height / 2 }));
    },
    cursorMode(kind) { cursorOverride = kind; placeCursor(); },
    // Other people's cursors, for collaborative apps: a coloured arrow with a name tag.
    ghost(id, name, color, x, y) {
      const g = document.createElement('div');
      g.className = 'demo-ghost';
      g.id = 'demo-ghost-' + id;
      g.style.setProperty('--c', color);
      g.innerHTML = svg(`<path d="${arrowPath}" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>`) + `<span>${esc(name)}</span>`;
      g.style.transform = `translate(${x}px, ${y}px)`;
      ghosts.appendChild(g);
    },
    ghostMove(id, x, y, ms) {
      Object.assign($('demo-ghost-' + id).style, { transition: `transform ${ms}ms ${move}, opacity .3s`, transform: `translate(${x}px, ${y}px)` });
    },
    ghostTap(id, x, y) { rippleAt(x, y, $('demo-ghost-' + id).style.getPropertyValue('--c')); },
    ghostOff(id) {
      const g = $('demo-ghost-' + id);
      g.style.opacity = 0;
      setTimeout(() => g.remove(), 350 * window.__DEMO_TIME);
    },
    // side: right | left | top | bottom | inside | inside-right | inside-bottom-left | inside-bottom-right | center.
    // `avoid`: selectors of controls the cursor works on; when the preferred side
    // would cover one, the first side that covers none is used instead.
    // With callouts set to 'label', the callout shows only the label; the captions carry the line.
    tip(label, text, selectors, side, pad = 8, avoid = []) {
      const compact = window.__DEMO_CALLOUTS === 'label' && side !== 'center';
      if (compact && !label) { tip.classList.remove('on'); return; }
      tip.classList.toggle('compact', compact);
      tip.querySelector('.lab').textContent = label;
      tip.querySelector('.lab').style.display = label ? '' : 'none';
      tip.querySelector('.txt').textContent = compact ? label : text;
      tip.classList.toggle('big', side === 'center');
      const w = tip.offsetWidth, h = tip.offsetHeight, gap = 18, vw = innerWidth, vh = innerHeight;
      const r = side === 'center' ? null : rectOf(selectors, pad);
      const place = (sd) => {
        let x, y;
        if (sd === 'center') { x = (vw - w) / 2; y = (vh - h) / 2; }
        else if (sd === 'right') { x = r.right + gap; y = r.top; }
        else if (sd === 'left') { x = r.left - gap - w; y = r.top + (compact ? 0 : 40); }
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
      const el = find(selector);
      if (!el) throw new Error('demo: no element for ' + selector);
      return centerOfRect(el.getBoundingClientRect());
    },
    // Hidden while the page's own picture is taken (the intro's zoom, a before/after still).
    hideLayer(hidden) { host.style.visibility = hidden ? 'hidden' : ''; },
    // The still of the page before a change, laid over the live page until wipe() reveals it.
    before(src) {
      Object.assign(beforeImg.style, { width: innerWidth + 'px', height: innerHeight + 'px', transition: 'none', clipPath: 'inset(0 0 0 0)' });
      beforeImg.src = src;
      beforeImg.classList.add('on');
    },
    // A divider sweeps left to right: the live page (after) behind it, the still (before) ahead of it.
    wipe(ms, labels) {
      const curve = `${ms}ms cubic-bezier(.65,0,.35,1)`;
      const [beforeLabel, afterLabel] = labels;
      Object.assign(wipeBar.style, { transition: 'none', left: '0px' });
      wipeBar.children[0].textContent = afterLabel;
      wipeBar.children[1].textContent = beforeLabel;
      wipeBar.classList.add('on');
      void wipeBar.offsetWidth;
      Object.assign(wipeBar.style, { transition: `left ${curve}`, left: innerWidth + 'px' });
      Object.assign(beforeImg.style, { transition: `clip-path ${curve}`, clipPath: 'inset(0 0 0 100%)' });
      setTimeout(() => { beforeImg.classList.remove('on'); wipeBar.classList.remove('on'); }, (ms + 250) * window.__DEMO_TIME);
    },
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
    // The chapter's number and title, top left, for `ms` when the chapter starts.
    chip(n, total, title, ms) {
      chip.innerHTML = `<b>${n} / ${total}</b>${esc(title)}`;
      chip.classList.add('on');
      clearTimeout(chipTimer);
      chipTimer = setTimeout(() => chip.classList.remove('on'), ms * window.__DEMO_TIME);
    },
    speed(factor) {
      if (factor) speedBadge.textContent = `${factor}×`;
      speedBadge.classList.toggle('on', !!factor);
    },
    lower(title, subtitle) {
      lower.innerHTML = `<b>${esc(title)}</b>${subtitle ? `<span>${esc(subtitle)}</span>` : ''}`;
      lower.classList.add('on');
    },
    lowerOff() { lower.classList.remove('on'); },
    // A number card in a corner of the screen (`at`: top-right, top-left, bottom-right,
    // bottom-left), counting up from 0 in page time, so the take's slow clock applies.
    stat(label, value, prefix, suffix, decimals, ms, at) {
      const [v, h] = at.split('-'), corners = { top: '70px', bottom: '120px', left: '28px', right: '28px' };
      if (!corners[v] || !corners[h]) throw new Error(`demo: stat at "${at}"; use top-right, top-left, bottom-right or bottom-left`);
      Object.assign(stat.style, { top: '', bottom: '', left: '', right: '', [v]: corners[v], [h]: corners[h] });
      stat.innerHTML = `<small>${esc(label)}</small><b></b>`;
      const out = stat.querySelector('b'), start = performance.now(), total = ms * window.__DEMO_TIME;
      const format = (v) => prefix + v.toLocaleString(navigator.language, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
      const step = () => {
        const k = Math.min(1, (performance.now() - start) / total);
        out.textContent = format(value * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      stat.classList.add('on');
      step();
    },
    statOff() { stat.classList.remove('on'); },
    // A full-screen scene of the tour's own HTML (a diagram, a comparison), styled by `styles`.
    scene(html, styles) {
      scene.innerHTML = `<style>${styles}</style>${html}<svg class="demo-ink"></svg>`;
      window.__demoSceneDone = false;
      cover(true);
      scene.classList.add('on');
    },
    sceneOff() { scene.classList.remove('on'); cover(false); },
    // Boxes in a row, rising in one after another, each arrow drawn once both of its boxes are in.
    flow(steps, title, stepMs) {
      const boxes = steps.map((s, i) => `<div class="flow-box rise" id="demo-flow-${i}" style="${riseDelay(i, 0.3, stepMs / 1000)}"><b>${i + 1}</b>${esc(s)}</div>`);
      this.scene(`<div class="flow">${title ? `<h2 class="rise">${esc(title)}</h2>` : ''}<div class="flow-row">${boxes.join('')}</div></div>`, '');
      const lines = scene.querySelector('svg.demo-ink');
      steps.slice(1).map((_, i) => {
        const a = settledRect($('demo-flow-' + i)), b = settledRect($('demo-flow-' + (i + 1)));
        drawArrow(a, { x: b.left - 2, y: (b.top + b.bottom) / 2 }, 380, (300 + (i + 1) * stepMs) - 150, 0, lines, 'connector');
      });
    },
    // A terminal window: each command typed after its prompt, then its output.
    terminal(title, lines, typeMs) {
      this.scene(`<div class="win"><div class="win-hd"><i></i><i></i><i></i><span>${esc(title)}</span></div><pre></pre></div>`, '');
      const body = scene.querySelector('pre');
      const row = (className) => body.appendChild(Object.assign(document.createElement('div'), { className }));
      (async () => {
        await wait(450);
        for (const line of lines) {
          if (line.cmd === undefined) { row('out').textContent = line.out; await wait(120); continue; }
          const text = row('cmd');
          text.innerHTML = '<b>$</b> ';
          for (const ch of line.cmd) { text.append(ch); await wait(typeMs); }
          await wait(320);
        }
        window.__demoSceneDone = true;
      })();
    },
    // A code window: the code typed or shown, then the `highlight` lines (1-based) swept with colour.
    code(code, lang, highlight, typeMs) {
      const lines = code.split('\n');
      this.scene(`<div class="win"><div class="win-hd"><i></i><i></i><i></i><span>${esc(lang)}</span></div><pre>${lines.map((_, i) => `<div class="ln${highlight.includes(i + 1) ? ' hl' : ''}"><i>${i + 1}</i><span></span></div>`).join('')}</pre></div>`, '');
      const spans = [...scene.querySelectorAll('.ln span')], pre = scene.querySelector('pre');
      (async () => {
        await wait(450);
        for (let i = 0; i < lines.length; i++) {
          if (!typeMs) { spans[i].textContent = lines[i]; continue; }
          for (const ch of lines[i]) { spans[i].append(ch); await wait(typeMs); }
        }
        await wait(300);
        pre.classList.add('swept');
        await wait(650);
        window.__demoSceneDone = true;
      })();
    },
    // A card over the whole screen: an iris opens onto a logo, a kicker, the title word by
    // word, a subtitle, then a numbered list (a preview) or step pictures (a recap).
    card({ kicker = '', title = '', subtitle = '', items = [], steps = [], logo = '' }) {
      let n = 0;
      const rise = () => `class="rise" style="${riseDelay(n++)}"`;
      card.innerHTML = (logo ? `<div class="logo">${logo}</div>` : '')
        + (kicker ? `<div class="kicker"><span ${rise()}>${esc(kicker)}</span></div>` : '')
        + (title ? `<h1>${title.split(/\s+/).map(w => `<span ${rise()}>${esc(w)}</span>`).join(' ')}</h1>` : '')
        + (subtitle ? `<p ${rise()}>${esc(subtitle)}</p>` : '')
        + (items.length ? `<ol>${items.map((it, i) => `<li ${rise()}><b>${i + 1}</b>${esc(it)}</li>`).join('')}</ol>` : '')
        + (steps.length ? `<div class="steps" style="--cols:${Math.min(steps.length, 4)}">${steps.map((s, i) => `<figure ${rise()}><img src="${s.src}" alt=""><figcaption><b>${i + 1}</b>${esc(s.label)}</figcaption></figure>`).join('')}</div>` : '');
      void card.offsetWidth;
      card.classList.add('on');
      cover(true);
    },
    cardOff() { card.classList.remove('on'); cover(false); },
    // A stand-in for a native <select>'s popup or the browser's context menu, which screenshots never show.
    menuAt(x, y, labels, current) {
      menu.innerHTML = labels.map((t, i) => `<div class="row${i === current ? ' cur' : ''}" id="demo-menu-${i}">${esc(t)}</div>`).join('');
      Object.assign(menu.style, { left: x + 'px', top: y + 'px' });
      menu.classList.add('on');
    },
    menuHighlight(i) { [...menu.querySelectorAll('.row')].map((row, k) => row.classList.toggle('hl', k === i)); },
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
    chatCopied() { $('demo-chat-copy').textContent = 'Copied ✓'; },
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
    callouts = 'full',    // 'full': label and line; 'label': the label only, when captions carry the line
    pointer = 'mouse',    // 'touch': a touch circle in place of the cursor, for a phone-sized take
    locale,               // the browser's language for a translated take, e.g. 'es-ES'
    chapterChipMs = 2500, // how long the chapter chip shows as a chapter starts; 0 shows none
    prepare,              // async (context): init scripts, routes, storage, before the first page
    ready,                // async (page): wait until the app is ready to film
    tour,                 // async (t): the segments
  } = options;
  if (!dir || !url || !tour) throw new Error('record() needs dir, url and tour');
  if (mode !== 'dry' && mode !== 'rec') throw new Error(`mode is "dry" or "rec", not "${mode}"`);
  if (!['full', 'label'].includes(callouts)) throw new Error(`callouts is "full" or "label", not "${callouts}"`);
  if (!['mouse', 'touch'].includes(pointer)) throw new Error(`pointer is "mouse" or "touch", not "${pointer}"`);
  const lines = JSON.parse(fs.readFileSync(path.join(dir, 'narration.json'), 'utf8'));
  const unvoiced = lines.filter(l => !(l.dur > 0)).map(l => l.id);
  if (unvoiced.length) throw new Error(`Voice the narration first (node voice.cjs ${dir}); no length yet for: ${unvoiced.join(', ')}`);
  const lineById = Object.fromEntries(lines.map(l => [l.id, l]));
  const line = (id) => { if (!lineById[id]) throw new Error(`No narration line "${id}" in narration.json`); return lineById[id]; };
  // Chapters start at the lines that carry a `chapter` title.
  const chapters = lines.filter(l => l.chapter).map(l => l.id);
  // What the callout shows: the line, or its `card` when the screen should read differently
  // from what is spoken (the address on the closing card, while the voice says "this portal").
  const onScreen = (id) => line(id).card || line(id).text;
  const pause = (ms) => sleep(ms * time);   // a choreography pause, in video time

  const browser = await chromium.launch();
  const timeline = { time, viewport, scale, segs: [], says: [], cuts: [], speeds: [], moves: [], frames: [] };
  const mark = (list, extra) => list.push({ t: Date.now() / 1000, ...extra });
  const steps = [];   // dry run: a still and its line per segment, for guide.cjs
  let capturing = false, captureErrors = 0, capture = Promise.resolve(), finished = false;
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: scale, ...(locale ? { locale } : {}) });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(url).origin });
    // The page's own clocks run at 1/time, so its timers and the overlay's count in video time.
    await context.addInitScript(`window.__DEMO_TIME = 1; window.__DEMO_CALLOUTS = ${JSON.stringify(callouts)}; window.__DEMO_POINTER = ${JSON.stringify(pointer)};`
      + `(${slowPageClock.toString()})(${time}, ${scale}); document.addEventListener('DOMContentLoaded', ${installOverlay.toString()})`);
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

    const demo = (fn, ...args) => page.evaluate(([name, a]) => window.__demo[name](...a), [fn, args]);
    let mouse = { x: viewport.width / 2, y: viewport.height / 2 };

    // The camera: the part of the page each frame shows. A frame is that rect captured at
    // whatever scale fills 1920 pixels, so a zoom renders the page sharp instead of upscaling it.
    const aspect = viewport.width / viewport.height;
    const whole = { x: 0, y: 0, w: viewport.width };
    // Keeps a camera rect inside the page: no wider than it, no narrower than an 8x zoom.
    const fit = (c) => {
      const w = clamp(c.w, viewport.width / 8, viewport.width), h = w / aspect;
      return { w, x: clamp(c.x, 0, viewport.width - w), y: clamp(c.y, 0, viewport.height - h) };
    };
    let shot = { from: whole, to: whole, start: 0, ms: 0, curve: ease }, follow = null;
    const cameraAt = (now) => {
      if (follow) {
        // Eases toward a frame centred on the cursor, `lag` ms of video behind it.
        const w = viewport.width / follow.zoom, target = fit({ x: mouse.x - w / 2, y: mouse.y - w / aspect / 2, w });
        const k = 1 - Math.exp(-(now - follow.t) / time / follow.lag), c = follow.c;
        follow.c = { x: c.x + (target.x - c.x) * k, y: c.y + (target.y - c.y) * k, w: c.w + (target.w - c.w) * k };
        follow.t = now;
        return follow.c;
      }
      const k = shot.ms ? Math.min(1, (now - shot.start) / shot.ms) : 1, e = shot.curve(k);
      const mix = (a, b) => a + (b - a) * e;
      return { x: mix(shot.from.x, shot.to.x), y: mix(shot.from.y, shot.to.y), w: mix(shot.from.w, shot.to.w) };
    };
    const clipOf = (c) => ({ x: c.x, y: c.y, width: c.w, height: c.w / aspect, scale: scale * viewport.width / c.w });
    // `blur`: build.cjs may motion-blur this move (MOTION_BLUR=1); slow drifts are left sharp.
    const moveCamera = async (to, ms, { curve = ease, blur = true } = {}) => {
      const now = Date.now(), from = cameraAt(now);
      follow = null;
      shot = { from, to: fit(to), start: now, ms: ms * time, curve };
      if (blur && ms) timeline.moves.push({ start: now / 1000, end: (now + ms * time) / 1000 });
      await sleep(ms * time);
    };

    // Frames from Chrome's own screenshot at clip scale: its screencast only delivers
    // the CSS size (1280x720). PNG, because JPEG noise costs the web encode more bits than it saves.
    const clip = clipOf(whole);
    // One capture at a time: a clip capture briefly overrides the page's scale, and two
    // interleaved ones (the frame loop and the intro's picture) can come back tiled.
    let captureQueue = Promise.resolve(), holdFrames = false;
    // The clip is in page coordinates, so it moves with the window's scroll; a fixed one
    // captures the unpainted area above the viewport once the page scrolls (blank frames).
    const captureShot = (params) => {
      const s = captureQueue.then(async () => {
        const { cssVisualViewport: view } = await cdp.send('Page.getLayoutMetrics');
        const clip = params.clip && { ...params.clip, x: params.clip.x + view.pageX, y: params.clip.y + view.pageY };
        return cdp.send('Page.captureScreenshot', { ...params, clip });
      });
      captureQueue = s.catch(() => {});
      return s;
    };
    // The screen layer is counter-scaled to the camera before a frame or still is taken.
    let hudCamera = '';
    const syncHud = async (c) => {
      const key = [c.x, c.y, c.w].map(v => v.toFixed(2)).join();
      if (key === hudCamera) return;
      hudCamera = key;
      await demo('hudCamera', c, viewport.width);
    };
    // The page alone, overlay hidden: the frame loop holds still meanwhile, so the video
    // shows the frame before instead of one without the overlay.
    const pagePicture = async (params) => {
      holdFrames = true;
      try {
        await captureQueue;
        await demo('hideLayer', true);
        const { data } = await captureShot(params);
        await demo('hideLayer', false);
        return data;
      } finally {
        holdFrames = false;
      }
    };
    if (mode === 'rec') {
      capturing = true;
      const framesDir = path.join(dir, 'frames');
      if (fs.existsSync(framesDir) && fs.readdirSync(framesDir).length) throw new Error(`${framesDir} already holds frames; move it aside first`);
      fs.mkdirSync(framesDir, { recursive: true });
      capture = (async () => {
        for (let i = 0; capturing;) {
          if (holdFrames) { await sleep(5); continue; }
          const t = Date.now() / 1000;
          try {
            const c = cameraAt(t * 1000);
            await syncHud(c);
            if (holdFrames) continue;   // a page picture started while the screen layer was syncing
            const { data } = await captureShot({ format: 'png', optimizeForSpeed: true, clip: clipOf(c) });
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

    await page.mouse.move(mouse.x, mouse.y);
    // For guide.cjs: what each segment acts on (the last click, spotlight or focus), as its hotspot.
    let target = null;
    // Time-based, so a move takes `ms` of video however slow each input event is. Longer
    // moves bow slightly, as a hand on a mouse does; drags and scrubs stay straight.
    const glide = async (x, y, ms, straight = false) => {
      const from = { ...mouse }, start = Date.now();
      const dx = x - from.x, dy = y - from.y, dist = Math.hypot(dx, dy);
      const bow = straight || dist < 80 ? 0 : Math.min(40, dist * 0.08) / dist;
      for (;;) {
        const k = Math.min(1, (Date.now() - start) / (ms * time)), e = ease(k), arc = Math.sin(Math.PI * e) * bow;
        mouse = { x: from.x + dx * e - dy * arc, y: from.y + dy * e + dx * arc };
        await page.mouse.move(mouse.x, mouse.y);
        if (k === 1) break;
        await sleep(12);
      }
      mouse = { x, y };
    };
    const center = (selector) => demo('centerOf', selector);
    const glideTo = async (selector, ms, dx = 0, dy = 0) => { const c = await center(selector); await glide(c.x + dx, c.y + dy, ms); };
    const click = async () => { target = { ...mouse }; await page.mouse.down(); await sleep(70); await page.mouse.up(); };
    const clickOn = async (selector, ms = 600) => { await glideTo(selector, ms); await click(); };
    const drag = async (dx, dy, ms) => {
      await page.mouse.down();
      await pause(80);
      await glide(mouse.x + dx, mouse.y + dy, ms, true);
      await pause(60);
      await page.mouse.up();
    };
    // Picks `from` up and drops it on `to`, with a closed hand while it is held.
    const dragTo = async (from, to, { ms = 900 } = {}) => {
      await glideTo(from, 600);
      await demo('cursorMode', 'grabbing');
      await page.mouse.down();
      await pause(120);
      const c = await center(to);
      await glide(c.x, c.y, ms, true);
      await pause(80);
      await page.mouse.up();
      target = { ...mouse };
      await demo('cursorMode', null);
    };
    // Selects an element's text with an I-beam, from its first line to its last.
    const selectText = async (selector, { ms = 700 } = {}) => {
      const r = await demo('box', [selector], 0);
      await demo('cursorMode', 'text');
      await glide(r.left + 2, r.top + 8, 500);
      await page.mouse.down();
      await glide(r.right - 2, r.bottom - 8, ms, true);
      await page.mouse.up();
      target = r;
      await demo('cursorMode', null);
    };
    // Glides the cursor along an SVG line or path (or across a box), so the app's own hover
    // readout follows it; `from` and `to` are shares of the length.
    const scrub = async (selector, { ms = 1500, from = 0, to = 1 } = {}) => {
      const pts = await demo('pointsAlong', selector, from, to, 48);
      await glide(pts[0].x, pts[0].y, 500);
      const start = Date.now();
      for (;;) {
        const k = Math.min(1, (Date.now() - start) / (ms * time)), at = k * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(at)), u = at - i;
        mouse = { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u };
        await page.mouse.move(mouse.x, mouse.y);
        if (k === 1) break;
        await sleep(12);
      }
    };
    // A click on an overlay element (menu row, chat button): the ripple only, nothing underneath is clicked.
    const tapOverlay = async (selector, ms = 500) => { await glideTo(selector, ms); await demo('ripple', mouse.x, mouse.y); await pause(150); };
    // A chapter's chip shows when its first line starts.
    const announceChapter = async (id) => {
      const n = chapters.indexOf(id);
      if (n >= 0 && chapterChipMs) await demo('chip', n + 1, chapters.length, line(id).chapter, chapterChipMs);
    };
    // Callouts take `avoid`: the controls the cursor is about to use stay uncovered.
    const say = async (id, label, selectors, side, pad, avoid = []) => {
      mark(timeline.says, { id });
      await announceChapter(id);
      await demo('tip', label, onScreen(id), selectors, side, pad, avoid);
    };
    // Starts line `id` without a callout (over a card, or where ink does the pointing).
    const speak = async (id) => { line(id); mark(timeline.says, { id }); await announceChapter(id); };
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
    // When `word` starts within line `id`, in seconds from the line's start. voice.cjs keeps
    // Kokoro's own word timings; a line voiced without them falls back to the word's share of the text.
    const wordStart = (id, word) => {
      const l = line(id), norm = (s) => s.toLowerCase().replace(/[^a-z0-9']/g, '');
      const hit = (l.words || []).find(w => norm(w.text) === norm(word));
      if (hit) return hit.start;
      const text = l.voicedText || l.text, i = text.indexOf(word);
      if (i < 0) throw new Error(`untilWord: "${word}" is not in the ${id} line`);
      return i / text.length * l.dur;
    };
    // Waits until line `id` reaches `word`, so an action lands on the word that names it.
    const untilWord = async (id, word) => {
      const said = timeline.says.filter(s => s.id === id).pop();
      if (!said) throw new Error(`untilWord: "${id}" has not been said yet`);
      const at = said.t * 1000 + wordStart(id, word) * 1000 * time;
      if (Date.now() < at) await sleep(at - Date.now());
    };
    // Dropped from the video (a list or grid loading); build.cjs refuses one inside a spoken line.
    const offCamera = async (run) => {
      mark(timeline.cuts, { edge: 'start' });
      await run();
      mark(timeline.cuts, { edge: 'end' });
    };
    // Played `factor` times faster, with a badge saying so (long typing, a repeated action).
    // Like a cut, it has to sit outside any spoken line.
    const fastForward = async (run, { factor = 3 } = {}) => {
      const start = Date.now() / 1000;
      await demo('speed', factor);
      await run();
      await demo('speed', null);
      timeline.speeds.push({ start, end: Date.now() / 1000, factor });
    };
    const segment = async (id, run) => {
      const start = Date.now();
      mark(timeline.segs, { id });
      target = null;
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
        // Through the camera, so a still shows the framing the video will have.
        const c = cameraAt(Date.now());
        await syncHud(c);
        const { data } = await captureShot({ format: 'png', clip: clipOf(c) });
        const file = `${String(timeline.segs.length).padStart(2, '0')}-${id}.png`;
        fs.writeFileSync(path.join(stills, file), Buffer.from(data, 'base64'));
        // The hotspot in the still's own pixels: page coordinates through the camera.
        const k = viewport.width / c.w, toStill = (x, y) => ({ x: (x - c.x) * k / viewport.width, y: (y - c.y) * k / viewport.height });
        const hotspot = target && (target.width ? { ...toStill(target.left, target.top), w: target.width * k / viewport.width, h: target.height * k / viewport.height } : toStill(target.x, target.y));
        steps.push({ id, still: file, text: line(id).text, label: line(id).label || '', chapter: line(id).chapter || '', hotspot });
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
    // A shortcut as a user presses it, its keys shown next to the cursor ('Meta+K' shows ⌘ K).
    const keyLabels = { Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: '⇧', Enter: '↵ Enter', Escape: 'Esc', Backspace: '⌫', Tab: '⇥ Tab', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    const press = async (keys, { label } = {}) => {
      await demo('key', label || keys.split('+').map(k => keyLabels[k] || k.toUpperCase()).join(' '));
      await page.keyboard.press(keys);
      await pause(600);
      await demo('key', null);
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
    const wheelTo = async (container, targetSelector, offset = 10) => {
      await glideTo(container, 350);
      const dy = await page.evaluate(([c, t, off]) => {
        const box = document.querySelector(c), el = document.querySelector(t);
        if (!box || !el) throw new Error(`wheelTo: no ${box ? t : c}`);
        return el.getBoundingClientRect().top - box.getBoundingClientRect().top - off;
      }, [container, targetSelector, offset]);
      const notches = Math.max(1, Math.ceil(Math.abs(dy) / 120));
      for (let i = 0; i < notches; i++) { await page.mouse.wheel(0, dy / notches); await pause(28); }
      await pause(200);
    };
    // Opens the overlay menu at a point, glides to row `pick`, and taps it.
    const pickFromMenu = async (x, y, labels, current, pick) => {
      await demo('menuAt', x, y, labels, current);
      await pause(450);
      await glideTo(`#demo-menu-${pick}`, 600);
      await demo('menuHighlight', pick);
      await pause(250);
      await demo('ripple', mouse.x, mouse.y);
      await pause(150);
      await demo('menuOff');
    };
    // A native <select>'s popup never shows in screenshots, so the overlay menu stands in:
    // point at the select, its options open, the cursor picks one, then the real value is set.
    // No Escape afterwards: in many apps it closes the surrounding modal.
    const pickOption = async (selector, value) => {
      await glideTo(selector, 550);
      await demo('ripple', mouse.x, mouse.y);
      const opts = await page.$$eval(`${selector} option`, os => os.map(o => ({ value: o.value, text: o.textContent.trim() })));
      const current = await page.$eval(selector, el => el.value);
      const pick = opts.findIndex(o => o.value === value);
      if (pick < 0) throw new Error(`${selector} has no option "${value}"; it has ${opts.map(o => o.value).join(', ')}`);
      const r = await demo('box', [selector], 0);
      target = r;
      await pickFromMenu(r.left, r.bottom + 6, opts.map(o => o.text), opts.findIndex(o => o.value === current), pick);
      await page.selectOption(selector, value);
    };
    // The browser's own context menu never shows either: this draws one at the cursor and
    // picks row `pick`. The tour then does what that row would (the app's handler, an API call).
    const contextMenu = async (items, pick) => {
      await demo('ripple', mouse.x, mouse.y);
      target = { ...mouse };
      await pickFromMenu(mouse.x + 4, mouse.y + 4, items, -1, pick);
    };
    // After a navigation: the new document has the overlay again, but at full animation speed.
    const navigated = async () => {
      await page.waitForFunction(() => window.__demo, null, { timeout: 30000 });
      await slowMotion();
      hudCamera = '';
      await page.mouse.move(mouse.x, mouse.y);
    };
    // The opening: a browser window, `address` typed into its bar, the page shown inside
    // with the address ringed while line `id` plays, then zoomed to full screen on `zoomAtWord`.
    // voiceFirst starts the line with the segment, so the address is typed under the voice
    // instead of in four silent seconds; typeAtWord then starts the typing on its word.
    const intro = async ({ id, label = '', address, zoomAtWord, afterZoom, voiceFirst = false, typeAtWord }) => {
      if (timeline.segs.length) throw new Error('intro() must come before any other segment');
      if (typeAtWord && !voiceFirst) throw new Error('intro: typeAtWord needs voiceFirst, so the line is playing while the address is typed');
      // The page's picture for the zoom: the mouse off the content so no hover readout is
      // baked in, and Chrome's own capture (Playwright's page.screenshot re-sets the device
      // emulation, and the frame loop would inherit the wrong scale).
      await page.mouse.move(viewport.width / 2, 4);
      await sleep(300);
      const picture = 'data:image/jpeg;base64,' + await pagePicture({ format: 'jpeg', quality: 95, clip });
      await demo('browserShow');
      mouse = { x: viewport.width / 2, y: viewport.height * 0.58 };
      await page.mouse.move(mouse.x, mouse.y);
      await sleep(800);   // the video's lead-in frames then show the window, not the page behind it
      // Under the voice the beats are tighter: the typing lands on the words that describe it.
      const beat = voiceFirst ? { lead: 200, glide: 700, settle: 100, type: 900, typed: 950, enter: 300, loaded: 200 }
        : { lead: 500, glide: 800, settle: 250, type: 1300, typed: 1450, enter: 450, loaded: 400 };
      await segment(id, async () => {
        if (voiceFirst) await speak(id);
        await pause(beat.lead);
        await glideTo('#demo-browser .url', beat.glide);
        await demo('ripple', mouse.x, mouse.y);
        await pause(beat.settle);
        if (typeAtWord) await untilWord(id, typeAtWord);
        await demo('browserType', address, beat.type);
        await pause(beat.typed);
        await demo('key', '↵ Enter');
        await pause(beat.enter);
        await demo('key', null);
        await demo('browserLoad', picture);
        await pause(beat.loaded);
        await demo('spot', ['#demo-browser .url'], 6);
        if (voiceFirst) await demo('tip', label, onScreen(id), ['#demo-browser .url'], 'bottom', 6, ['#demo-browser .url']);
        else await say(id, label, ['#demo-browser .url'], 'bottom', 6, ['#demo-browser .url']);
        // The cursor drifts off the address while the line reaches its zoom word.
        const drift = glide(viewport.width * 0.6, viewport.height * 0.65, 900);
        if (!voiceFirst) await drift;
        await untilWord(id, zoomAtWord);
        await drift;
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
    // Not awaiting a camera move lets it run while the line and cursor carry on.
    const camera = {
      // Frames `selectors` at up to `zoom`x with `pad` px of room around them, eased over `ms` of video.
      focus: async (selectors, { zoom = 2, pad = 48, ms = 900 } = {}) => {
        const r = await demo('box', selectors, pad);
        const w = Math.max(viewport.width / zoom, r.width, r.height * aspect);
        await moveCamera({ x: (r.left + r.right) / 2 - w / 2, y: (r.top + r.bottom) / 2 - w / aspect / 2, w }, ms);
      },
      reset: (ms = 900) => moveCamera(whole, ms),
      // Zoomed in on the cursor, trailing it by `lag` ms of video, until the next camera call.
      follow: async ({ zoom = 1.8, lag = 250 } = {}) => {
        const now = Date.now();
        follow = { zoom, lag, t: now, c: cameraAt(now) };
      },
      // A slow push in on the current framing, for a held shot: `scale` 1.06 is a 6% closer frame.
      drift: async ({ scale: closer = 1.06, ms = 3000 } = {}) => {
        const c = cameraAt(Date.now()), w = c.w / closer;
        await moveCamera({ x: c.x + (c.w - w) / 2, y: c.y + (c.w - w) / aspect / 2, w }, ms, { curve: linear, blur: false });
      },
    };
    // Stills taken during the take, for a recap card's step pictures.
    const snaps = {};
    const snap = async (name) => {
      const c = cameraAt(Date.now());
      await syncHud(c);
      snaps[name] = 'data:image/jpeg;base64,' + (await captureShot({ format: 'jpeg', quality: 85, clip: clipOf(c) })).data;
    };
    const snapOf = (name) => { if (!snaps[name]) throw new Error(`card: no snap "${name}"; take it with t.snap('${name}') first`); return snaps[name]; };
    // Other people's cursors (collaborative apps). Only the main cursor clicks for real; a
    // ghost's actions are the tour's to perform (an API call, a page.evaluate) when it taps.
    let ghostCount = 0;
    const ghost = async ({ name, color = '#12805c', at = [viewport.width * 0.7, viewport.height * 0.3] } = {}) => {
      const id = ++ghostCount;
      let pos = { x: at[0], y: at[1] };
      await demo('ghost', id, name, color, pos.x, pos.y);
      return {
        glideTo: async (selector, ms = 800, dx = 0, dy = 0) => {
          const c = await center(selector);
          pos = { x: c.x + dx, y: c.y + dy };
          await demo('ghostMove', id, pos.x, pos.y, ms);
          await pause(ms);
        },
        tap: async () => { await demo('ghostTap', id, pos.x, pos.y); await pause(150); },
        remove: () => demo('ghostOff', id),
      };
    };

    const t = {
      page, context, cdp, mode, time, viewport, sleep, pause,
      demo, spot: async (sel, pad = 8) => { await demo('spot', sel, pad); target = await demo('box', sel, pad); },
      spotOff: () => demo('spotOff'), tipOff: () => demo('tipOff'),
      focus: async (sel, pad = 10) => { await demo('focus', sel, pad); target = await demo('box', sel, pad); }, focusOff: () => demo('focusOff'),
      ink: (kind, sel, { pad = 10, ms = 650 } = {}) => demo('ink', kind, sel, pad, ms),
      arrow: (from, to, { ms = 600, bend = 0.2 } = {}) => demo('arrow', from, to, ms, bend),
      pulse: (sel) => demo('pulse', sel), badge: (sel, n) => demo('badge', sel, n),
      note: (sel, text, { dx = -220, dy = -70, ms = 600 } = {}) => demo('note', sel, text, dx, dy, ms),
      inkOff: () => demo('inkOff'),
      dim: (sel, { except = [], opacity = 0.18 } = {}) => demo('dim', sel, except, opacity), undim: () => demo('undim'),
      before: async () => demo('before', 'data:image/jpeg;base64,' + await pagePicture({ format: 'jpeg', quality: 92, clip })),
      wipe: async ({ ms = 1000, labels = ['Before', 'After'] } = {}) => { await demo('wipe', ms, labels); await pause(ms + 300); },
      lowerThird: ({ title, subtitle = '' }) => demo('lower', title, subtitle), lowerThirdOff: () => demo('lowerOff'),
      stat: ({ label, value, prefix = '', suffix = '', decimals = 0, ms = 1200, at = 'top-right' }) => demo('stat', label, value, prefix, suffix, decimals, ms, at),
      statOff: () => demo('statOff'),
      scene: ({ html, css = '' }) => demo('scene', html, css), sceneOff: () => demo('sceneOff'),
      // Returns once the last box and arrow are in.
      flow: async (boxes, { title = '', stepMs = 350 } = {}) => { await demo('flow', boxes, title, stepMs); await pause(300 + boxes.length * stepMs + 450); },
      terminal: async ({ title = 'Terminal', lines: rows, typeMs = 35 }) => {
        await demo('terminal', title, rows, typeMs);
        await page.waitForFunction(() => window.__demoSceneDone, null, { timeout: 120000 });
      },
      code: async ({ code, lang = '', highlight = [], typeMs = 0 }) => {
        await demo('code', code, lang, highlight, typeMs);
        await page.waitForFunction(() => window.__demoSceneDone, null, { timeout: 120000 });
      },
      card: ({ kicker, title, subtitle, items, steps = [], logo } = {}) => demo('card', { kicker, title, subtitle, items, logo, steps: steps.map(s => ({ src: snapOf(s.snap), label: s.label })) }),
      cardOff: () => demo('cardOff'),
      keycap: (text) => demo('key', text),
      get mouse() { return { ...mouse }; },
      glide, glideTo, center, click, clickOn, drag, dragTo, selectText, scrub, tapOverlay, typeInto, paste, press, wheelTo,
      pickOption, contextMenu, settle, ghost, snap,
      say, speak, retip, sayNext, untilWord, offCamera, fastForward, segment, navigated, intro, chat, camera,
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
    if (finished && mode === 'dry') fs.writeFileSync(path.join(dir, 'dry', 'steps.json'), JSON.stringify(steps, null, 1));
    await browser.close();
  }
}

module.exports = { record };
