declare global {
	interface Window {
		__heroBgSwapInit?: boolean;
	}
}

function removeBlurWhenLoaded() {
	document.querySelectorAll<HTMLElement>(".cover-hero-image[data-bg-full]").forEach((el) => {
		const full = el.dataset.bgFull;
		if (!full || el.dataset.bgState === "full") return;

		const removeBlur = () => {
			el.dataset.bgState = "full";
		};

		const img = new Image();
		img.onload = removeBlur;
		img.onerror = removeBlur;
		img.src = full;
	});
}

export function initHeroBackgroundSwap() {
	if (typeof window === "undefined") return;
	if (window.__heroBgSwapInit) return;
	window.__heroBgSwapInit = true;

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", removeBlurWhenLoaded);
	} else {
		removeBlurWhenLoaded();
	}
}

if (typeof window !== "undefined") {
	initHeroBackgroundSwap();
}
