import { fontProviders } from "astro/config";

/**
 * Parses a Google Fonts URL and returns font configurations for Astro's Font API
 * @param googleFontsUrl - The combined Google Fonts URL (e.g., from constants-config.json5)
 * @param sansFontName - Font name to map to --font-sans
 * @param serifFontName - Font name to map to --font-serif
 * @param monoFontName - Font name to map to --font-mono
 * @returns Array of font configurations for Astro
 */
export function parseGoogleFontsUrl(
	googleFontsUrl: string,
	sansFontName?: string,
	serifFontName?: string,
	monoFontName?: string,
) {
	const fonts = [];

	// Extract all font families from URL
	const familyMatch = googleFontsUrl.match(/family=([^&]+)/g);

	if (!familyMatch) {
		return [];
	}

	// Parse display parameter (e.g., display=swap)
	// Default to "swap" for better UX (shows text immediately with fallback font)
	const displayMatch = googleFontsUrl.match(/display=([^&]+)/);
	const fontDisplay = displayMatch ? displayMatch[1] : "swap";

	// Parse subset parameter (e.g., subset=latin,cyrillic)
	// If no subset specified, don't set it - let Astro/Google Fonts use all available subsets
	const subsetMatch = googleFontsUrl.match(/subset=([^&]+)/);
	const subsets = subsetMatch ? subsetMatch[1].split(",") : undefined;

	// Handle escaped spaces in font names from JSON5 config
	const sanitizedSans = sansFontName?.replaceAll("\\ ", " ") || "";
	const sanitizedSerif = serifFontName?.replaceAll("\\ ", " ") || "";
	const sanitizedMono = monoFontName?.replaceAll("\\ ", " ") || "";

	familyMatch.forEach((family) => {
		// Extract family name (e.g., "Roboto" or "Roboto+Mono")
		const nameMatch = family.match(/family=([^:&]+)/);
		if (!nameMatch) return;

		// Replace + with spaces (Google uses + for spaces in URLs)
		const familyName = nameMatch[1].replaceAll("+", " ");

		// Extract weights and styles (e.g., "ital,wght@0,400;0,500;1,400")
		const weightsMatch = family.match(/wght@([^&]+)/);
		const weights = new Set<number>();
		const styles = new Set<string>();

		if (weightsMatch) {
			const weightPairs = weightsMatch[1].split(";");
			weightPairs.forEach((pair) => {
				const [italic, weight] = pair.split(",");
				if (weight) {
					weights.add(parseInt(weight));
					styles.add(italic === "1" ? "italic" : "normal");
				}
			});
		} else {
			// Default if no weights specified
			weights.add(400);
			styles.add("normal");
		}

		// Determine which CSS variable this font should use
		let cssVariable = "--font-sans";
		let fallbacks = ["sans-serif"];

		if (sanitizedMono && familyName === sanitizedMono) {
			cssVariable = "--font-mono";
			fallbacks = ["monospace"];
		} else if (sanitizedSerif && familyName === sanitizedSerif) {
			cssVariable = "--font-serif";
			fallbacks = ["serif"];
		} else if (sanitizedSans && familyName === sanitizedSans) {
			cssVariable = "--font-sans";
			fallbacks = ["sans-serif"];
		}
		// If no match, defaults to --font-sans (already set above)

		const fontConfig: any = {
			provider: fontProviders.google(),
			name: familyName,
			cssVariable,
			weights: Array.from(weights).sort((a, b) => a - b),
			styles: Array.from(styles),
			fallbacks,
			optimizedFallbacks: true,
		};

		// Only add subsets if explicitly specified in URL
		if (subsets) {
			fontConfig.subsets = subsets;
		}

		// Always set display (defaults to "swap" for better UX)
		fontConfig.display = fontDisplay;

		fonts.push(fontConfig);
	});

	// Validation: warn if configured fonts aren't found in URL
	const foundFontNames = fonts.map((f) => f.name);
	if (sanitizedSans && !foundFontNames.includes(sanitizedSans)) {
		console.warn(
			`⚠️  Font "${sanitizedSans}" specified in sans-font-name not found in Google Fonts URL`,
		);
	}
	if (sanitizedSerif && !foundFontNames.includes(sanitizedSerif)) {
		console.warn(
			`⚠️  Font "${sanitizedSerif}" specified in serif-font-name not found in Google Fonts URL`,
		);
	}
	if (sanitizedMono && !foundFontNames.includes(sanitizedMono)) {
		console.warn(
			`⚠️  Font "${sanitizedMono}" specified in mono-font-name not found in Google Fonts URL`,
		);
	}

	return fonts;
}
