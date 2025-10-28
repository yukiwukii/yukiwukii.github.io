import type { AstroIntegration } from "astro";
import { CITATIONS_ENABLED, CITATIONS } from "../constants";
import { parseBibTeXFiles } from "../lib/citations";

/**
 * Citations Initializer Integration
 *
 * Runs at astro:build:start to fetch and parse all BibTeX files before the main build.
 * This ensures:
 * - BibTeX sources are fetched once at the start, not during getAllEntries()
 * - Proper caching with LAST_BUILD_TIME comparison
 * - All citation data is ready before any page requests it
 *
 * Without this integration, BibTeX initialization happens lazily on first getAllEntries() call,
 * which can cause delays and inconsistent timing.
 */
export default (): AstroIntegration => ({
	name: "citations-initializer",
	hooks: {
		"astro:build:start": async () => {
			if (!CITATIONS_ENABLED || !CITATIONS) {
				return;
			}

			const bibUrls = CITATIONS["extract-and-process-bibtex-citations"]?.["bibtex-file-url-list"];
			if (!bibUrls || bibUrls.length === 0) {
				console.log("Citations: No BibTeX URLs configured");
				return;
			}

			console.log(`\nCitations: Initializing BibTeX cache with ${bibUrls.length} source(s)...`);
			try {
				const bibEntriesCache = await parseBibTeXFiles(bibUrls);
				console.log(`Citations: ✓ Loaded ${bibEntriesCache.size} unique entries\n`);
			} catch (error) {
				console.error("Citations: Failed to initialize BibTeX cache:", error);
				// Don't throw - let the build continue, citations just won't work
			}
		},
	},
});
