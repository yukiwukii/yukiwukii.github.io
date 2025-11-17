import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";

import path from "path";
import fs from "fs";
import JSON5 from "json5";
import { CUSTOM_DOMAIN, BASE_PATH } from "./src/constants";
import remarkExternalMdxAssets from "./src/lib/external-content/remark-external-mdx-assets";

function ensureBlankLineAfterImports(source: string): string {
	const lines = source.split(/\r?\n/);
	let idx = 0;
	let sawImport = false;

	while (idx < lines.length) {
		const trimmed = lines[idx].trim();
		if (!trimmed) {
			if (!sawImport) {
				idx += 1;
				continue;
			}
			break;
		}
		if (/^(import|export)\s/.test(trimmed)) {
			sawImport = true;
			idx += 1;
			continue;
		}
		break;
	}

	if (!sawImport) return source;
	if (idx >= lines.length) return source;
	if (lines[idx].trim() === "") return source;

	lines.splice(idx, 0, "");
	return lines.join("\n");
}
const getSite = function () {
	if (CUSTOM_DOMAIN) {
		return new URL(BASE_PATH, `https://${CUSTOM_DOMAIN}`).toString();
	}
	if (process.env.VERCEL && process.env.VERCEL_URL) {
		return new URL(BASE_PATH, `https://${process.env.VERCEL_URL}`).toString();
	}
	if (process.env.CF_PAGES) {
		if (process.env.CF_PAGES_BRANCH !== "main") {
			return new URL(BASE_PATH, process.env.CF_PAGES_URL).toString();
		}
		return new URL(
			BASE_PATH,
			`https://${new URL(process.env.CF_PAGES_URL).host.split(".").slice(1).join(".")}`,
		).toString();
	}
	if (process.env.GITHUB_PAGES) {
		return new URL(process.env.BASE || BASE_PATH, process.env.SITE).toString();
	}
	return new URL(BASE_PATH, "http://localhost:4321").toString();
};
import CustomIconDownloader from "./src/integrations/custom-icon-downloader";
import EntryCacheEr from "./src/integrations/entry-cache-er";
import PublicNotionCopier from "./src/integrations/public-notion-copier";
import blocksHtmlCacher from "./src/integrations/block-html-cache-er";
import DeleteBuildCache from "./src/integrations/delete-build-cache";
import buildTimestampRecorder from "./src/integrations/build-timestamp-recorder";
import rssContentEnhancer from "./src/integrations/rss-content-enhancer";
import CSSWriter from "./src/integrations/theme-constants-to-css";
import createFoldersIfMissing from "./src/integrations/create-folders-if-missing";
import citationsInitializer from "./src/integrations/citations-initializer";
import astroImageCacheCleanerCopier from "./src/integrations/astro-image-cache-cleaner-copier";
import externalContentDownloader from "./src/integrations/external-content-downloader";
import { fontProviders } from "astro/config";
import robotsTxt from "astro-robots-txt";
import partytown from "@astrojs/partytown";

const configContent = fs.readFileSync("./constants-config.json5", "utf8");
const config = JSON5.parse(configContent);
const key_value_from_json = {
	...config,
};
function modifyRedirectPaths(
	redirects: Record<string, string>,
	basePath: string,
): Record<string, string> {
	const modifiedRedirects: Record<string, string> = {};

	// Normalize basePath: ensure it starts with "/" and remove trailing slash.
	if (!basePath.startsWith("/")) {
		basePath = "/" + basePath;
	}
	basePath = basePath.replace(/\/+$/, ""); // remove trailing slashes

	for (const [key, value] of Object.entries(redirects)) {
		// If it's an external URL, leave it unchanged.
		if (value.startsWith("http://") || value.startsWith("https://")) {
			modifiedRedirects[key] = value;
			continue;
		}

		// Ensure value starts with a slash.
		let normalizedValue = value.startsWith("/") ? value : "/" + value;
		modifiedRedirects[key] = path.posix.join(basePath, normalizedValue);
	}

	return modifiedRedirects;
}

// https://astro.build/config
export default defineConfig({
	site: getSite(),
	base: process.env.BASE || BASE_PATH,
	cacheDir: "./tmp/.astro",
	redirects: key_value_from_json?.redirects
		? modifyRedirectPaths(key_value_from_json.redirects, process.env.BASE || BASE_PATH)
		: {},
	experimental: {
		fonts: (() => {
			const fontConfig = key_value_from_json?.theme?.["fontfamily-google-fonts"];

			if (!fontConfig) {
				return [];
			}

			const fonts = [];
			// Standard weights and styles for all fonts
			const weights = [400, 500, 600, 700];
			const styles = ["normal", "italic"];

			const sansFontName = fontConfig["sans-font-name"];
			const monoFontName = fontConfig["mono-font-name"];

			// Add main body/UI font (can be sans or serif typeface)
			if (sansFontName) {
				fonts.push({
					provider: fontProviders.google(),
					name: sansFontName,
					cssVariable: "--font-sans",
					weights,
					styles,
					fallbacks: ["sans-serif"],
					optimizedFallbacks: true,
					display: "swap",
				});
			}

			// Add mono font
			if (monoFontName) {
				// If mono is the ONLY font set, also use it for body text (--font-sans)
				if (!sansFontName) {
					fonts.push({
						provider: fontProviders.google(),
						name: monoFontName,
						cssVariable: "--font-sans",
						weights,
						styles,
						fallbacks: ["monospace", "sans-serif"],
						optimizedFallbacks: true,
						display: "swap",
					});
				}
				// Always add mono to --font-mono for code blocks
				fonts.push({
					provider: fontProviders.google(),
					name: monoFontName,
					cssVariable: "--font-mono",
					weights,
					styles,
					fallbacks: ["monospace"],
					optimizedFallbacks: true,
					display: "swap",
				});
			}

			return fonts;
		})(),
	},
	integrations: [
		createFoldersIfMissing(),
		mdx({
			remarkPlugins: [remarkExternalMdxAssets],
		}),
		externalContentDownloader(),
		buildTimestampRecorder(),
		citationsInitializer(), // Initialize BibTeX cache after timestamp is recorded
		EntryCacheEr(),
		CustomIconDownloader(),
		CSSWriter(),
		partytown({
			// Adds dataLayer.push as a forwarding-event.
			config: {
				forward: ["dataLayer.push"],
			},
		}),
		robotsTxt({
			sitemapBaseFileName: "sitemap",
		}),
		rssContentEnhancer(),
		blocksHtmlCacher(),
		PublicNotionCopier(),
		astroImageCacheCleanerCopier(),
		DeleteBuildCache(),
	],
	image: {
		domains: ["webmention.io"],
	},
	prefetch: true,
	vite: {
		plugins: [
			{
				name: "external-custom-components-fallback",
				enforce: "pre",
				load(id) {
					const normalized = id.split(path.sep).join(path.sep);
					const target = `${path.sep}src${path.sep}components${path.sep}custom-components${path.sep}`;
					if (!normalized.includes(target)) return null;
					if (fs.existsSync(id)) return null;
					if (!/\.(astro|jsx|tsx|js|ts)$/.test(id)) return null;
					return `---\nconst { children, ...props } = Astro.props;\n---\n<div class="missing-remote-component" data-missing-component={${JSON.stringify(
						id,
					)}} {...props}>\n  <slot />\n</div>\n`;
				},
			},
			{
				name: "external-mdx-prep",
				enforce: "pre",
				transform(code, id) {
					if (
						!id.endsWith(".mdx") ||
						!id.includes(`${path.sep}src${path.sep}external-posts${path.sep}`)
					) {
						return null;
					}
					const adjusted = ensureBlankLineAfterImports(code);
					return adjusted === code ? null : adjusted;
				},
			},
			tailwindcss(),
		],
		resolve: {
			alias: {
				"custom-components": path.resolve("./src/components/custom-components"),
				"@custom-components": path.resolve("./src/components/custom-components"),
			},
		},
		optimizeDeps: {
			exclude: ["@resvg/resvg-js"],
		},
	},
});
