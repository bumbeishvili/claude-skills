<script>
	// `data-calc` inspector (Svelte + Tailwind reference). Add `#debug` to any URL
	// and every element carrying a `data-calc` attribute gets outlined with a "ƒx"
	// badge; hovering a badge shows its calculation formula and plain-English note.
	// Remove the hash (or press Esc) to switch it off. Mount ONCE in the root layout,
	// after the page slot, so it overlays every route. Uses Tailwind utility classes —
	// for a zero-dependency drop-in, use data-debug-overlay.js instead.
	import { onMount } from 'svelte';

	let enabled = false;
	/** @type {Array<{x: number, y: number, w: number, h: number, text: string, note: string|null}>} viewport rects, one per visible [data-calc] */
	let marks = [];
	/** @type {{x: number, y: number, text: string, note: string|null} | null} the hovered badge's formula card */
	let tip = null;
	/** @type {number | null} */
	let raf = null;

	const readHash = () => (enabled = window.location.hash === '#debug');

	// Re-measure every frame while enabled — charts animate in, columns scroll and
	// modals mount asynchronously, so a one-off scan would go stale immediately.
	function loop() {
		// While a modal is open, only mark ITS elements — badges of the page
		// underneath would bleed through the backdrop and read as part of the modal.
		const modal = document.querySelector('.fixed.inset-0.z-50, [aria-modal="true"], [role="dialog"], dialog[open]');
		marks = [...document.querySelectorAll('[data-calc]')]
			.filter((el) => !modal || modal.contains(el))
			.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					x: r.left,
					y: r.top,
					w: r.width,
					h: r.height,
					text: el.getAttribute('data-calc') ?? '',
					note: el.getAttribute('data-calc-note')
				};
			})
			.filter((m) => m.w > 0 && m.h > 0);
		raf = requestAnimationFrame(loop);
	}

	$: if (typeof window !== 'undefined') {
		if (enabled && raf === null) loop();
		if (!enabled && raf !== null) {
			cancelAnimationFrame(raf);
			raf = null;
			marks = [];
			tip = null;
		}
	}

	/** @param {KeyboardEvent} event */
	function exitDebug(event) {
		if (event.key !== 'Escape' || !enabled) return;
		history.replaceState(null, '', window.location.pathname + window.location.search);
		readHash();
	}

	onMount(() => {
		readHash();
		return () => raf !== null && cancelAnimationFrame(raf);
	});
</script>

<svelte:window on:hashchange={readHash} on:keydown={exitDebug} />

{#if enabled}
	<div class="pointer-events-none fixed inset-0 z-[9999]">
		{#each marks as m (m.text + m.x + m.y)}
			<div
				class="absolute rounded-md border border-dashed border-[#5450f8]"
				style="left: {m.x - 3}px; top: {m.y - 3}px; width: {m.w + 6}px; height: {m.h + 6}px;"
			>
				<!-- svelte-ignore a11y-no-static-element-interactions -->
				<span
					class="pointer-events-auto absolute -left-px -top-[22px] cursor-help rounded-t-md bg-[#5450f8] px-2 py-[3px] font-['Poppins'] text-[11px] font-semibold leading-none text-white"
					on:mouseenter={() => (tip = { x: m.x, y: m.y, text: m.text, note: m.note })}
					on:mouseleave={() => (tip = null)}
				>
					ƒx
				</span>
			</div>
		{/each}

		{#if tip}
			<div
				class="absolute z-10 max-w-[520px] rounded-lg border border-[#5450f8] bg-[#1b1b1b] px-4 py-3 font-mono text-[12px] leading-[18px] text-[#e3e8ff] shadow-xl"
				style="left: {Math.min(tip.x, window.innerWidth - 540)}px; {tip.y < 280
					? `top: ${tip.y + 28}px;`
					: `top: ${tip.y - 8}px; transform: translateY(-100%);`}"
			>
				<!-- One clause per line: formulas are written as ";"-separated clauses -->
				{#each tip.text.split(/;\s+/) as clause}
					<div class="py-[1px] pl-3 -indent-3">{clause}</div>
				{/each}
				{#if tip.note}
					<div class="mt-2 border-t border-white/20 pt-2 font-['Poppins'] text-[12px] font-normal leading-[18px] text-white/90">
						{tip.note}
					</div>
				{/if}
			</div>
		{/if}

		<div
			class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[#1b1b1b] px-4 py-2 font-['Poppins'] text-[12px] text-white shadow-lg"
		>
			data-calc debug — hover a ƒx badge for the formula · Esc to exit
		</div>
	</div>
{/if}
