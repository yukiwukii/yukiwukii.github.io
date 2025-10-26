import {
	computePosition,
	offset,
	shift,
	flip,
	autoUpdate,
} from "https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.7.4/+esm";

document.addEventListener("DOMContentLoaded", () => {
	// State variables for popovers
	let popoverTriggersSet = new Set(); // Track which elements have listeners

	// Determine if it's a mobile device
	let isSmBreakpoint = window.matchMedia("(max-width: 639px)").matches;
	let isLargeScreen = window.matchMedia("(min-width: 1024px)").matches;

	// Create the selector based on the device type
	// Exclude footnote markers with data-margin-note on large screens (they use margin notes instead)
	function getPopoverSelector() {
		const isSmBreakpoint = window.matchMedia("(max-width: 639px)").matches;
		const isLargeScreen = window.matchMedia("(min-width: 1024px)").matches;

		return isSmBreakpoint
			? '[data-popover-target]:not([data-popover-type-lm="true"])'
			: isLargeScreen
				? "[data-popover-target]:not([data-margin-note])"
				: "[data-popover-target]";
	}

	// Select popover triggers based on the device-specific selector
	const popoverTriggers = document.querySelectorAll(getPopoverSelector());

	let openPopovers = [];
	let cleanupAutoUpdate = new Map();
	let hoverTimeouts = new Map();

	const getPopoverLevel = (el) => {
		let level = 0;
		while (el && el.closest("[data-popover-target]")) {
			level++;
			el = el.parentElement;
		}
		// console.log(level - 1);
		return level - 1;
	};

	const hideAllPopovers = (level = 0) => {
		// console.log('hideAllPopovers called');
		// console.log(openPopovers);
		openPopovers.forEach((popoverEl) => {
			if (getPopoverLevel(popoverEl) >= level) {
				hidePopover(popoverEl);
			}
		});
	};

	const hidePopover = (popoverEl) => {
		// console.log('hidePopover called for', popoverEl);
		if (popoverEl) {
			popoverEl.style.visibility = "hidden";
			popoverEl.classList.add("hidden");
			popoverEl.style.opacity = "0";
			popoverEl.style.top = "0px";
			popoverEl.style.left = "0px";

			const cleanup = cleanupAutoUpdate.get(popoverEl);
			if (cleanup) {
				cleanup();
				cleanupAutoUpdate.delete(popoverEl);
			}
			const openPopoverIndex = openPopovers.indexOf(popoverEl);
			if (openPopoverIndex !== -1) {
				openPopovers.splice(openPopoverIndex, 1);
			}
		}
	};

	const addPTEventListeners = (triggerEl, popoverEl) => {
		const isLinkMention = triggerEl.dataset.popoverTypeLm === "true";
		if (isLinkMention && isSmBreakpoint) {
			return;
		}
		if (triggerEl && popoverEl) {
			triggerEl.addEventListener("mouseleave", () => {
				const timeoutId = setTimeout(() => {
					hidePopover(popoverEl);
				}, 100);
				hoverTimeouts.set(popoverEl, timeoutId);
			});

			triggerEl.addEventListener("blur-sm", () => {
				hidePopover(popoverEl);
			});

			popoverEl.addEventListener("mouseenter", () => {
				const timeoutId = hoverTimeouts.get(popoverEl);
				if (timeoutId) {
					clearTimeout(timeoutId);
				}
			});

			popoverEl.addEventListener("mouseleave", () => {
				hidePopover(popoverEl);
			});
		}

		triggerEl.addEventListener("mouseenter", () => {
			const timeoutId = popoverEl ? hoverTimeouts.get(popoverEl) : null;
			if (timeoutId) {
				clearTimeout(timeoutId);
				hoverTimeouts.delete(popoverEl);
			}
			showPopover(triggerEl);
		});

		triggerEl.addEventListener("focus", () => {
			showPopover(triggerEl);
		});

		// Add click event listener for desktop link behavior (only for non-link-mentions)
		if (!isLinkMention) {
			triggerEl.addEventListener("click", (event) => {
				const href = triggerEl.dataset.href;
				if (href && !isSmBreakpoint) {
					// Use !isSmBreakpoint instead of window.matchMedia
					event.preventDefault();
					window.location.href = href;
				} else {
					showPopover(triggerEl);
				}
			});
		}
	};

	const createPopover = (triggerEl) => {
		const popoverID = triggerEl.dataset.popoverTarget;
		const template = document.getElementById(`template-${popoverID}`);
		if (!template) return null;
		const popoverEl = template.content.firstElementChild.cloneNode(true);
		triggerEl.parentNode.insertBefore(popoverEl, triggerEl.nextSibling);
		addPTEventListeners(triggerEl, popoverEl);
		// Add event listeners to any new popover triggers within this popover
		const nestedSelector = isSmBreakpoint
			? '[data-popover-target]:not([data-popover-type-lm="true"])'
			: isLargeScreen
				? "[data-popover-target]:not([data-margin-note])"
				: "[data-popover-target]";
		const nestedTriggers = popoverEl.querySelectorAll(nestedSelector);
		nestedTriggers.forEach((nestedTrigger) => {
			addPTEventListeners(nestedTrigger, null);
		});
		return popoverEl;
	};

	const showPopover = (triggerEl) => {
		const level = getPopoverLevel(triggerEl);
		hideAllPopovers(level);
		let popoverEl = document.getElementById(triggerEl.dataset.popoverTarget);

		if (!popoverEl) {
			popoverEl = createPopover(triggerEl);
		}
		if (!popoverEl) return;

		const update = () => {
			computePosition(triggerEl, popoverEl, {
				middleware: [
					offset(6),
					shift({
						padding: 3,
					}),
					flip({
						padding: 3,
					}),
				],
			}).then(({ x, y }) => {
				Object.assign(popoverEl.style, {
					left: `${x}px`,
					top: `${y}px`,
					position: "absolute",
				});
			});
		};

		update();
		popoverEl.classList.remove("hidden");
		requestAnimationFrame(() => {
			popoverEl.style.visibility = "visible";
			popoverEl.style.opacity = "1";
		});

		openPopovers.push(popoverEl);
		cleanupAutoUpdate.set(popoverEl, autoUpdate(triggerEl, popoverEl, update));
	};

	// Function to initialize popover triggers for footnote markers only (on resize to small screen)
	const initializeFootnotePopoverTriggers = () => {
		// Only add listeners to footnote markers that don't already have them
		const footnoteMarkers = document.querySelectorAll("[data-margin-note]");

		footnoteMarkers.forEach((triggerEl) => {
			// Only add listeners if not already added
			if (!popoverTriggersSet.has(triggerEl)) {
				addPTEventListeners(triggerEl, null);
				popoverTriggersSet.add(triggerEl);
			}
		});
	};

	// Initialize popovers for the first time
	popoverTriggers.forEach((triggerEl) => {
		addPTEventListeners(triggerEl, null);
		popoverTriggersSet.add(triggerEl);
	});

	// Store the initialization function globally so resize handler can access it
	window.reinitializeFootnotePopovers = initializeFootnotePopoverTriggers;

	document.addEventListener("click", (event) => {
		const popoverLink = event.target.closest("[data-popover-link]");
		if (popoverLink) {
			hideAllPopovers(-1);
		} else if (!event.target.closest("[data-popover-target]")) {
			hideAllPopovers(-1);
		}
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			hideAllPopovers(-1);
		}
	});
});
