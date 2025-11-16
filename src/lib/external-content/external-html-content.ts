import fs from "node:fs";
import path from "node:path";
import type { Post } from "@/lib/interfaces";
import type { Heading } from "@/types";
import { EXTERNAL_CONTENT_PATHS } from "@/constants";
import { transformExternalHtml } from "./external-html-utils";

type HtmlRenderResult = {
	html: string;
	headings: Heading[];
};

export function renderExternalHtml(post: Post): HtmlRenderResult {
	const descriptor = post.ExternalContent;
	if (!descriptor || descriptor.type !== "html") {
		return { html: "", headings: [] };
	}

	const entryDir = path.join(EXTERNAL_CONTENT_PATHS.externalPosts, descriptor.folderName);
	const entryPath = path.join(entryDir, "index.html");
	if (!fs.existsSync(entryPath)) {
		console.warn(
			`[external-content] Missing index.html for external post "${post.Slug}" at ${entryPath}`,
		);
		return { html: "", headings: [] };
	}

	let fileContents = "";
	try {
		fileContents = fs.readFileSync(entryPath, "utf-8");
	} catch (error) {
		console.warn(
			`[external-content] Failed to read HTML file for "${post.Slug}" (${entryPath})`,
			error,
		);
		return { html: "", headings: [] };
	}

	return transformExternalHtml(fileContents, descriptor);
}
