/**
 * Citations Extraction System
 *
 * This module contains ALL citation extraction logic for Webtrotion.
 * It handles:
 * - Fetching BibTeX files from GitHub, Dropbox, Google Drive
 * - Parsing BibTeX entries using citation-js
 * - Extracting citations from text ([@key], \cite{key}, #cite(key))
 * - Formatting citations as APA or IEEE
 * - Generating bibliographies
 *
 * Key principles:
 * - Preserve ALL RichText formatting (bold, italic, colors, etc.)
 * - Process at BUILD-TIME only (in client.ts)
 * - Components have ZERO logic, only render pre-processed data
 * - Cache BibTeX files with timestamp checking
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";
import type {
	Block,
	RichText,
	Citation,
	CitationsConfig,
	BibSourceInfo,
	BibFileMeta,
	CitationExtractionResult,
	RichTextLocation,
} from "./interfaces";
import { getAllRichTextLocations, cloneRichText, joinPlainText } from "./footnotes";
import { BUILD_FOLDER_PATHS, LAST_BUILD_TIME } from "../constants";

// ============================================================================
// URL Normalization and Source Detection
// ============================================================================

/**
 * Converts a share link to a direct-download URL and provides timestamp checking info
 *
 * Supports:
 * - GitHub Gist: https://gist.github.com/user/id
 * - GitHub Repo: https://github.com/user/repo/blob/branch/path/file.bib
 * - Dropbox: https://www.dropbox.com/scl/fi/.../file.bib?dl=0
 * - Google Drive: https://drive.google.com/file/d/FILE_ID/view
 */
export function get_bib_source_info(url: string): BibSourceInfo {
	// GitHub Gist
	const gistMatch = url.match(/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/);
	if (gistMatch) {
		const [, username, gistId] = gistMatch;
		return {
			source: "github-gist",
			download_url: `https://gist.githubusercontent.com/${username}/${gistId}/raw`,
			updated_url: `https://api.github.com/gists/${gistId}`,
			updated_instructions: `curl -s <updated_url> | jq '.updated_at'`,
		};
	}

	// GitHub Repo File
	const repoMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
	if (repoMatch) {
		const [, owner, repo, branch, filePath] = repoMatch;
		return {
			source: "github-repo",
			download_url: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
			updated_url: `https://api.github.com/repos/${owner}/${repo}/commits?path=${filePath}`,
			updated_instructions: `curl -s <updated_url> | jq '.[0].commit.committer.date'`,
		};
	}

	// Dropbox
	if (url.includes("dropbox.com")) {
		return {
			source: "dropbox",
			download_url: url.replace("dl=0", "dl=1"),
			updated_url: null,
			updated_instructions: "Dropbox shared links do not expose public timestamps",
		};
	}

	// Google Drive
	const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^\/]+)/);
	if (driveMatch) {
		const [, fileId] = driveMatch;
		return {
			source: "google-drive",
			download_url: `https://drive.google.com/uc?export=download&id=${fileId}`,
			updated_url: null,
			updated_instructions: "Google Drive shared links do not expose public timestamps",
		};
	}

	// Unknown source - return as-is
	return {
		source: "unknown",
		download_url: url,
		updated_url: null,
		updated_instructions: null,
	};
}

// ============================================================================
// BibTeX File Fetching with Caching
// ============================================================================

/**
 * Updates the BibTeX files mapping to track URL → cached filename
 */
function updateBibFilesMapping(url: string, urlHash: string, downloadUrl: string): void {
	const cacheDir = BUILD_FOLDER_PATHS.bibFilesCache;
	const mappingPath = path.join(cacheDir, "bib-files-mapping.json");

	// Load existing mapping
	let mapping: Record<string, any> = {};
	if (fs.existsSync(mappingPath)) {
		try {
			mapping = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
		} catch (error) {
			console.warn("Failed to parse bib-files-mapping.json, creating new one");
			mapping = {};
		}
	}

	// Extract original filename from URL
	let originalName = "unknown.bib";
	try {
		const urlPath = new URL(downloadUrl).pathname;
		const parts = urlPath.split("/");
		const lastPart = parts[parts.length - 1];
		if (lastPart && lastPart.endsWith(".bib")) {
			originalName = lastPart;
		}
	} catch (error) {
		// Use hash if URL parsing fails
		originalName = `${urlHash}.bib`;
	}

	// Update mapping
	mapping[url] = {
		cached_as: `${urlHash}.bib`,
		original_name: originalName,
		download_url: downloadUrl,
		last_updated: new Date().toISOString(),
	};

	// Save mapping
	fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), "utf-8");
}

/**
 * Gets last-updated timestamp for a GitHub source
 * Returns null if unavailable or on error
 */
async function getGitHubLastUpdated(updatedUrl: string): Promise<string | null> {
	try {
		const response = await axios.get(updatedUrl, { timeout: 5000 });
		if (updatedUrl.includes("/gists/")) {
			// Gist API response
			return response.data?.updated_at || null;
		} else {
			// Repo commits API response
			return response.data?.[0]?.commit?.committer?.date || null;
		}
	} catch (error) {
		console.warn(`Failed to get last-updated timestamp from ${updatedUrl}:`, error);
		return null;
	}
}

/**
 * Fetches a BibTeX file with intelligent caching
 *
 * Strategy:
 * - Check if cached file exists
 * - For GitHub: Check last-updated timestamp, skip fetch if unchanged
 * - For Dropbox/Drive: Fetch every time (no public timestamp) unless within same build
 * - Save to cache with metadata
 */
export async function fetchBibTeXFile(url: string): Promise<string> {
	const sourceInfo = get_bib_source_info(url);
	const urlHash = crypto.createHash("md5").update(url).digest("hex");
	const cacheDir = BUILD_FOLDER_PATHS.bibFilesCache;
	const bibFilePath = path.join(cacheDir, `${urlHash}.bib`);
	const metaFilePath = path.join(cacheDir, `${urlHash}.meta.json`);

	// Ensure cache directory exists
	if (!fs.existsSync(cacheDir)) {
		fs.mkdirSync(cacheDir, { recursive: true });
	}

	// Check if cached file exists
	let existingMeta: BibFileMeta | null = null;
	if (fs.existsSync(bibFilePath) && fs.existsSync(metaFilePath)) {
		try {
			existingMeta = JSON.parse(fs.readFileSync(metaFilePath, "utf-8"));
		} catch (error) {
			console.warn(`Failed to parse metadata for ${url}, will re-fetch`);
			existingMeta = null;
		}
	}

	// Determine if we should refetch
	let shouldRefetch = !existingMeta;

	if (existingMeta) {
		// Dropbox/Drive: ALWAYS refetch (no public timestamp API to verify changes)
		if (!sourceInfo.updated_url) {
			console.log(`BibTeX file ${url} from Dropbox/Drive, re-fetching (cannot verify changes)...`);
			shouldRefetch = true;
		}
		// GitHub sources: Can check remote timestamp and use LAST_BUILD_TIME optimization
		else if (LAST_BUILD_TIME) {
			const lastFetched = new Date(existingMeta.last_fetched);

			// If cached file was fetched AFTER last build, use cache without checking remote
			if (lastFetched >= LAST_BUILD_TIME) {
				console.log(`BibTeX file ${url} already fetched in this build (cached)`);
				shouldRefetch = false;
			} else {
				// Cached before last build: check remote timestamp
				const remoteLastUpdated = await getGitHubLastUpdated(sourceInfo.updated_url);
				if (
					remoteLastUpdated &&
					existingMeta.last_updated &&
					remoteLastUpdated !== existingMeta.last_updated
				) {
					console.log(`BibTeX file ${url} has been updated remotely, re-fetching...`);
					shouldRefetch = true;
				} else if (remoteLastUpdated) {
					console.log(`BibTeX file ${url} is up-to-date (cached)`);
					shouldRefetch = false;
				}
			}
		}
		// GitHub without LAST_BUILD_TIME: check remote timestamp
		else {
			const remoteLastUpdated = await getGitHubLastUpdated(sourceInfo.updated_url);
			if (
				remoteLastUpdated &&
				existingMeta.last_updated &&
				remoteLastUpdated !== existingMeta.last_updated
			) {
				console.log(`BibTeX file ${url} has been updated remotely, re-fetching...`);
				shouldRefetch = true;
			} else if (remoteLastUpdated) {
				console.log(`BibTeX file ${url} is up-to-date (cached)`);
				shouldRefetch = false;
			}
		}
	}

	// Return cached content if we don't need to refetch
	if (!shouldRefetch && existingMeta) {
		return fs.readFileSync(bibFilePath, "utf-8");
	}

	// Fetch from remote
	console.log(`Fetching BibTeX file from ${sourceInfo.download_url}...`);
	try {
		const response = await axios.get(sourceInfo.download_url, { timeout: 10000 });
		const content = response.data;

		// Parse to count entries
		let entryCount = 0;
		let remoteLastUpdated: string | null = null;
		try {
			const parsed = new Cite(content);
			entryCount = parsed.data.length;
		} catch (error) {
			console.warn(`Failed to parse BibTeX from ${url}, but saving anyway:`, error);
		}

		// Get remote timestamp if available
		if (sourceInfo.updated_url) {
			remoteLastUpdated = await getGitHubLastUpdated(sourceInfo.updated_url);
		}

		// Save to cache
		fs.writeFileSync(bibFilePath, content, "utf-8");
		const meta: BibFileMeta = {
			url: url,
			last_updated: remoteLastUpdated,
			entry_count: entryCount,
			last_fetched: new Date().toISOString(),
		};
		fs.writeFileSync(metaFilePath, JSON.stringify(meta, null, 2), "utf-8");

		// Update mapping file
		updateBibFilesMapping(url, urlHash, sourceInfo.download_url);

		console.log(`✓ Fetched and cached ${entryCount} entries from ${url}`);
		return content;
	} catch (error) {
		console.error(`Failed to fetch BibTeX file from ${url}:`, error);
		// Return cached content if fetch fails and we have cache
		if (existingMeta) {
			console.log(`Using cached version as fallback`);
			return fs.readFileSync(bibFilePath, "utf-8");
		}
		throw error;
	}
}

// ============================================================================
// BibTeX Parsing
// ============================================================================

/**
 * Saves combined BibTeX entries to cache
 */
function saveCombinedEntries(entries: Map<string, any>): void {
	const cacheDir = BUILD_FOLDER_PATHS.bibFilesCache;
	const combinedPath = path.join(cacheDir, "combined-entries.json");

	// Convert Map to object for JSON serialization
	const entriesObject = Object.fromEntries(entries);

	fs.writeFileSync(combinedPath, JSON.stringify(entriesObject, null, 2), "utf-8");
	console.log(`✓ Saved ${entries.size} combined entries to cache`);
}

/**
 * Loads combined BibTeX entries from cache
 * Returns null if cache doesn't exist or is invalid
 */
function loadCombinedEntries(): Map<string, any> | null {
	const cacheDir = BUILD_FOLDER_PATHS.bibFilesCache;
	const combinedPath = path.join(cacheDir, "combined-entries.json");

	if (!fs.existsSync(combinedPath)) {
		return null;
	}

	try {
		const content = fs.readFileSync(combinedPath, "utf-8");
		const entriesObject = JSON.parse(content);
		const entries = new Map<string, any>(Object.entries(entriesObject));
		console.log(`✓ Loaded ${entries.size} entries from combined cache`);
		return entries;
	} catch (error) {
		console.warn("Failed to load combined entries cache:", error);
		return null;
	}
}

/**
 * Checks if any BibTeX source file has been updated since last parse
 */
async function needsReparsing(urls: string[]): Promise<boolean> {
	const cacheDir = BUILD_FOLDER_PATHS.bibFilesCache;
	const combinedPath = path.join(cacheDir, "combined-entries.json");

	// If combined cache doesn't exist, need to parse
	if (!fs.existsSync(combinedPath)) {
		return true;
	}

	// Check if any source file is newer than combined cache
	const combinedStat = fs.statSync(combinedPath);
	const combinedMtime = combinedStat.mtime;

	for (const url of urls) {
		const urlHash = crypto.createHash("md5").update(url).digest("hex");
		const bibFilePath = path.join(cacheDir, `${urlHash}.bib`);

		if (fs.existsSync(bibFilePath)) {
			const bibStat = fs.statSync(bibFilePath);
			if (bibStat.mtime > combinedMtime) {
				console.log(`BibTeX file ${url} is newer than combined cache, reparsing...`);
				return true;
			}
		}
	}

	return false;
}

/**
 * Parses multiple BibTeX files and merges into a single map
 * Uses combined cache if available and up-to-date
 * Returns Map<key, entry> where key is the citation key (e.g., "smith2020")
 */
export async function parseBibTeXFiles(urls: string[]): Promise<Map<string, any>> {
	// Try to load from combined cache first
	const needsUpdate = await needsReparsing(urls);

	if (!needsUpdate) {
		const cached = loadCombinedEntries();
		if (cached) {
			return cached;
		}
	}

	// Parse from individual .bib files
	console.log("Parsing BibTeX files...");
	const allEntries = new Map<string, any>();

	for (const url of urls) {
		try {
			const content = await fetchBibTeXFile(url);
			const parsed = new Cite(content);

			// Add each entry to map (later entries override earlier ones if same key)
			for (const entry of parsed.data) {
				const key = entry.id || entry["citation-key"];
				if (key) {
					allEntries.set(key, entry);
				}
			}
		} catch (error) {
			console.error(`Failed to parse BibTeX from ${url}:`, error);
		}
	}

	console.log(`\nTotal BibTeX entries loaded: ${allEntries.size}`);

	// Save to combined cache
	saveCombinedEntries(allEntries);

	return allEntries;
}

// ============================================================================
// Citation Formatting
// ============================================================================

/**
 * Formats a citation entry for display
 *
 * @param entry - Raw entry from citation-js
 * @param style - "apa" or "simplified-ieee"
 * @returns Object with formatted strings
 */
export function formatCitation(
	entry: any,
	style: "apa" | "simplified-ieee",
): {
	inText: string;
	bibliography: string;
	authors: string;
	year: string;
} {
	// Get year
	const year = entry.issued?.["date-parts"]?.[0]?.[0]?.toString() || entry.year || "n.d.";

	// Get authors
	let authors = "Unknown";
	if (entry.author && entry.author.length > 0) {
		const authorList = entry.author;
		if (authorList.length === 1) {
			const author = authorList[0];
			authors = author.family || author.literal || "Unknown";
		} else if (authorList.length === 2) {
			authors = `${authorList[0].family || authorList[0].literal} & ${authorList[1].family || authorList[1].literal}`;
		} else {
			// Cap at 8 authors, then "et al."
			const displayCount = Math.min(8, authorList.length);
			if (authorList.length > 8) {
				const firstAuthors = authorList
					.slice(0, displayCount)
					.map((a: any) => a.family || a.literal)
					.join(", ");
				authors = `${firstAuthors}, et al.`;
			} else {
				const allButLast = authorList
					.slice(0, -1)
					.map((a: any) => a.family || a.literal)
					.join(", ");
				const last =
					authorList[authorList.length - 1].family || authorList[authorList.length - 1].literal;
				authors = `${allButLast} & ${last}`;
			}
		}
	}

	// Format bibliography entry using citation-js
	let bibliography = "";
	try {
		const cite = new Cite([entry]);
		// Use CSL style
		if (style === "apa") {
			bibliography = cite.format("bibliography", {
				format: "html",
				template: "apa",
				lang: "en-US",
			});
		} else {
			// simplified-ieee
			bibliography = cite.format("bibliography", {
				format: "html",
				template: "ieee",
				lang: "en-US",
			});
		}
		// Remove wrapping div if present
		bibliography = bibliography.replace(/<div[^>]*>|<\/div>/g, "").trim();
	} catch (error) {
		console.warn(`Failed to format citation for ${entry.id}:`, error);
		// Fallback formatting
		const title = entry.title || "Untitled";
		bibliography = `${authors} (${year}). ${title}.`;
	}

	// In-text format
	let inText = "";
	if (style === "apa") {
		inText = `${authors}, ${year}`;
	} else {
		// simplified-ieee uses numbers, but Index is assigned later
		inText = "[?]"; // Placeholder, will be replaced with actual number
	}

	return { inText, bibliography, authors, year };
}

// ============================================================================
// Citation Extraction from Block
// ============================================================================

/**
 * Splits a RichText array at a specific character position
 * Similar to the footnotes version but for citations
 */
function splitRichTextsAtCharPosition(
	richTexts: RichText[],
	splitCharPos: number,
): { before: RichText[]; after: RichText[] } {
	const before: RichText[] = [];
	const after: RichText[] = [];
	let currentPos = 0;

	for (const richText of richTexts) {
		const length = richText.PlainText.length;
		const rtStart = currentPos;
		const rtEnd = currentPos + length;

		if (splitCharPos <= rtStart) {
			after.push(richText);
		} else if (splitCharPos >= rtEnd) {
			before.push(richText);
		} else {
			const splitOffset = splitCharPos - rtStart;

			if (splitOffset > 0) {
				const beforePart = cloneRichText(richText);
				beforePart.PlainText = richText.PlainText.substring(0, splitOffset);
				if (beforePart.Text) {
					beforePart.Text.Content = beforePart.PlainText;
				}
				before.push(beforePart);
			}

			if (splitOffset < length) {
				const afterPart = cloneRichText(richText);
				afterPart.PlainText = richText.PlainText.substring(splitOffset);
				if (afterPart.Text) {
					afterPart.Text.Content = afterPart.PlainText;
				}
				after.push(afterPart);
			}
		}

		currentPos += length;
	}

	return { before, after };
}

/**
 * Extracts citations from a block's RichText arrays
 *
 * Supports three formats:
 * - [@key] (pandoc)
 * - \cite{key} (LaTeX)
 * - #cite(key) (typst)
 *
 * Returns citations with empty SourceBlockIds (populated later by extractCitationsInPage)
 */
export function extractCitationsFromBlock(
	block: Block,
	config: CitationsConfig,
	bibEntries: Map<string, any>,
): CitationExtractionResult {
	const citations: Citation[] = [];
	const locations = getAllRichTextLocations(block);

	if (locations.length === 0) {
		return { citations: [], processedRichTexts: false };
	}

	const citationFormat = config["extract-and-process-bibtex-citations"]["in-text-citation-format"];
	const bibliographyStyle = config["extract-and-process-bibtex-citations"]["bibliography-format"][
		"simplified-ieee"
	]
		? "simplified-ieee"
		: "apa";

	// Build regex based on format
	let pattern: RegExp;
	if (citationFormat === "[@key]") {
		pattern = /\[@([a-zA-Z0-9_\-:]+)\]/g;
	} else if (citationFormat === "\\cite{key}") {
		pattern = /\\cite\{([a-zA-Z0-9_\-:]+)\}/g;
	} else if (citationFormat === "#cite(key)") {
		pattern = /#cite\(([a-zA-Z0-9_\-:]+)\)/g;
	} else {
		console.warn(`Unknown citation format: ${citationFormat}`);
		return { citations: [], processedRichTexts: false };
	}

	let processedAny = false;

	// Process each RichText location
	for (const location of locations) {
		const fullText = joinPlainText(location.richTexts);
		const matches: { key: string; start: number; end: number; fullMatch: string }[] = [];

		// Find all matches
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(fullText)) !== null) {
			matches.push({
				key: match[1],
				start: match.index,
				end: match.index + match[0].length,
				fullMatch: match[0],
			});
		}

		if (matches.length === 0) continue;

		processedAny = true;

		// Replace matches with citation markers
		// Process in reverse order to maintain positions
		matches.reverse();

		let newRichTexts = [...location.richTexts];
		for (const m of matches) {
			// Look up citation key in bibEntries
			const entry = bibEntries.get(m.key);
			if (!entry) {
				console.warn(`Citation key "${m.key}" not found in BibTeX entries`);
				continue;
			}

			// Format citation
			const formatted = formatCitation(entry, bibliographyStyle as "apa" | "simplified-ieee");

			// Create Citation object
			const citation: Citation = {
				Key: m.key,
				FormattedEntry: formatted.bibliography,
				Authors: formatted.authors,
				Year: formatted.year,
				SourceBlockIds: [], // Will be populated later
			};
			citations.push(citation);

			// Split RichTexts at match boundaries
			const { before, after } = splitRichTextsAtCharPosition(newRichTexts, m.start);
			const { before: markerBefore } = splitRichTextsAtCharPosition(after, m.end - m.start);

			// Create marker RichText
			const markerText: RichText = {
				PlainText: m.fullMatch,
				Text: {
					Content: m.fullMatch,
				},
				Annotation: {
					Bold: false,
					Italic: false,
					Strikethrough: false,
					Underline: false,
					Code: false,
					Color: "default",
				},
				IsCitationMarker: true,
				CitationRef: m.key,
			};

			// Reconstruct RichTexts
			const afterMarker = after.slice(markerBefore.length);
			newRichTexts = [...before, markerText, ...afterMarker];
		}

		// Update the block's RichTexts
		location.setter(newRichTexts);
	}

	return { citations, processedRichTexts: processedAny };
}

// ============================================================================
// Prepare Bibliography
// ============================================================================

/**
 * Sorts citations for bibliography display
 *
 * - IEEE: By Index (order of first appearance) - [1], [2], [3]...
 * - APA: Alphabetically by Authors field
 */
export function prepareBibliography(
	citations: Citation[],
	style: "apa" | "simplified-ieee",
): Citation[] {
	const sorted = [...citations];

	if (style === "simplified-ieee") {
		// Sort by Index (first appearance order)
		sorted.sort((a, b) => (a.Index || 0) - (b.Index || 0));
	} else {
		// APA: Sort alphabetically by authors
		sorted.sort((a, b) => a.Authors.localeCompare(b.Authors));
	}

	return sorted;
}
