/*
 * data-debug-overlay.js — framework-agnostic `data-calc` inspector.
 *
 * Add `#debug` to any URL and every element carrying a `data-calc` attribute gets
 * outlined with a "ƒx" badge; hover the badge to see its formula (`data-calc`) and
 * plain-English note (`data-calc-note`). Press Esc — or remove the hash — to exit.
 *
 * Drop-in:  <script src="data-debug-overlay.js"></script>   (auto-inits on load)
 * Manual:   const overlay = initDataDebugOverlay({ accent, modalSelector });
 *           // ...later: overlay.destroy();
 *
 * Zero dependencies. Reads only the DOM, writes only its own overlay layer.
 */
(function () {
	var DEFAULTS = {
		accent: '#5450f8',
		// While one of these is open, only ITS [data-calc] marks show, so badges from
		// the page underneath don't bleed through the backdrop.
		modalSelector: '.fixed.inset-0.z-50, [aria-modal="true"], [role="dialog"], dialog[open]'
	};

	function initDataDebugOverlay(options) {
		var cfg = Object.assign({}, DEFAULTS, options || {});
		var enabled = false;
		var raf = null;
		var root = null;
		var hud = null;
		var tip = null; // the formula card element, when a badge is hovered
		var pool = []; // reused { box, badge } nodes so hover survives per-frame redraws

		function readHash() {
			setEnabled(window.location.hash === '#debug');
		}

		function ensureRoot() {
			if (root) return;
			root = document.createElement('div');
			root.setAttribute('data-calc-overlay', '');
			style(root, { position: 'fixed', inset: '0', zIndex: '9999', pointerEvents: 'none' });
			document.body.appendChild(root);

			hud = document.createElement('div');
			hud.textContent = 'data-calc debug — hover a ƒx badge for the formula · Esc to exit';
			style(hud, {
				position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
				background: '#1b1b1b', color: '#fff', borderRadius: '999px', padding: '8px 16px',
				font: "12px 'Poppins', system-ui, sans-serif", boxShadow: '0 6px 20px rgba(0,0,0,.3)'
			});
			root.appendChild(hud);
		}

		function setEnabled(on) {
			if (on === enabled) return;
			enabled = on;
			if (enabled) {
				ensureRoot();
				root.style.display = '';
				if (raf === null) loop();
			} else {
				if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
				if (root) root.style.display = 'none';
				hideTip();
			}
		}

		function loop() {
			draw();
			raf = requestAnimationFrame(loop);
		}

		function draw() {
			// While a modal is open, only mark elements inside it.
			var modal = document.querySelector(cfg.modalSelector);
			var els = [].slice.call(document.querySelectorAll('[data-calc]')).filter(function (el) {
				if (modal && !modal.contains(el)) return false;
				var r = el.getBoundingClientRect();
				return r.width > 0 && r.height > 0;
			});

			els.forEach(function (el, i) {
				var r = el.getBoundingClientRect();
				var node = pool[i] || createNode(i);
				node.box.style.display = '';
				style(node.box, {
					left: (r.left - 3) + 'px', top: (r.top - 3) + 'px',
					width: (r.width + 6) + 'px', height: (r.height + 6) + 'px'
				});
				// Store live data as JS props (NOT data-* attributes — a `data-calc` on the
				// badge would get re-selected next frame and spawn badges without end).
				node.badge._calc = el.getAttribute('data-calc') || '';
				node.badge._note = el.getAttribute('data-calc-note') || '';
				node.badge._x = r.left;
				node.badge._y = r.top;
				if (tip && tip._badge === node.badge) positionTip(node.badge); // follow a moving target
			});
			for (var i = els.length; i < pool.length; i++) pool[i].box.style.display = 'none';
			root.appendChild(hud); // keep hint on top
			if (tip) root.appendChild(tip);
		}

		function createNode(i) {
			var box = document.createElement('div');
			style(box, {
				position: 'absolute', borderRadius: '6px',
				border: '1px dashed ' + cfg.accent, pointerEvents: 'none'
			});
			var badge = document.createElement('span');
			badge.textContent = 'ƒx';
			style(badge, {
				position: 'absolute', left: '-1px', top: '-22px', pointerEvents: 'auto', cursor: 'help',
				background: cfg.accent, color: '#fff', borderRadius: '6px 6px 0 0', padding: '3px 8px',
				font: "600 11px/1 'Poppins', system-ui, sans-serif"
			});
			badge.addEventListener('mouseenter', function () { showTip(badge); });
			badge.addEventListener('mouseleave', hideTip);
			box.appendChild(badge);
			root.appendChild(box);
			return (pool[i] = { box: box, badge: badge });
		}

		function showTip(badge) {
			hideTip();
			tip = document.createElement('div');
			tip._badge = badge;
			style(tip, {
				position: 'absolute', zIndex: '10', maxWidth: '520px', background: '#1b1b1b',
				color: '#e3e8ff', border: '1px solid ' + cfg.accent, borderRadius: '8px',
				padding: '12px 16px', font: '12px/18px ui-monospace, SFMono-Regular, monospace',
				boxShadow: '0 10px 30px rgba(0,0,0,.35)', pointerEvents: 'none'
			});
			// One clause per line — formulas are written as ";"-separated clauses.
			(badge._calc || '').split(/;\s+/).forEach(function (clause) {
				var line = document.createElement('div');
				line.textContent = clause;
				style(line, { padding: '1px 0 1px 12px', textIndent: '-12px' });
				tip.appendChild(line);
			});
			if (badge._note) {
				var n = document.createElement('div');
				n.textContent = badge._note;
				style(n, {
					marginTop: '8px', borderTop: '1px solid rgba(255,255,255,.2)', paddingTop: '8px',
					font: "12px/18px 'Poppins', system-ui, sans-serif", color: 'rgba(255,255,255,.9)'
				});
				tip.appendChild(n);
			}
			root.appendChild(tip);
			positionTip(badge);
		}

		function positionTip(badge) {
			if (!tip) return;
			var x = badge._x, y = badge._y;
			tip.style.left = Math.min(x, window.innerWidth - 540) + 'px';
			if (y < 280) { tip.style.top = (y + 28) + 'px'; tip.style.transform = ''; }
			else { tip.style.top = (y - 8) + 'px'; tip.style.transform = 'translateY(-100%)'; }
		}

		function hideTip() {
			if (tip) { tip.remove(); tip = null; }
		}

		function onKey(e) {
			if (e.key !== 'Escape' || !enabled) return;
			history.replaceState(null, '', window.location.pathname + window.location.search);
			readHash();
		}

		function style(el, props) {
			for (var k in props) el.style[k] = props[k];
		}

		window.addEventListener('hashchange', readHash);
		window.addEventListener('keydown', onKey);
		readHash();

		return {
			destroy: function () {
				window.removeEventListener('hashchange', readHash);
				window.removeEventListener('keydown', onKey);
				setEnabled(false);
				if (root) { root.remove(); root = null; }
			}
		};
	}

	// Expose + auto-init for drop-in <script> usage.
	if (typeof window !== 'undefined') {
		window.initDataDebugOverlay = initDataDebugOverlay;
		if (document.readyState === 'loading')
			document.addEventListener('DOMContentLoaded', function () { initDataDebugOverlay(); });
		else initDataDebugOverlay();
	}
	if (typeof module !== 'undefined' && module.exports) module.exports = { initDataDebugOverlay: initDataDebugOverlay };
})();
