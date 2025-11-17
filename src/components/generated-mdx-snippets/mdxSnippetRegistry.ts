import type { AstroComponentFactory } from "astro/runtime/server/index.js";

type SnippetModule = { default: AstroComponentFactory };
const snippetModules = import.meta.glob<SnippetModule>("/src/posts/mdx-inject-snippets/**/*.mdx");

export async function mdxSnippetLookup(
	slug: string,
): Promise<{ Component: AstroComponentFactory | null }> {
	const key = Object.keys(snippetModules).find((k) => k.endsWith(`/${slug}.mdx`));
	if (!key) return { Component: null };
	try {
		const mod = await snippetModules[key]();
		return { Component: mod.default || null };
	} catch (error) {
		console.warn(`[mdx-snippet] Failed to load snippet ${slug}`, error);
		return { Component: null };
	}
}
