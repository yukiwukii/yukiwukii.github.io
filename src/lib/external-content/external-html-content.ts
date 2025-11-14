import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "htmlparser2";
import { DomUtils } from "htmlparser2";
import type { Element } from "domhandler";
import type { Post, ExternalContentDescriptor } from "@/lib/interfaces";
import type { Heading } from "@/types";
import { EXTERNAL_CONTENT_PATHS } from "@/constants";
import { slugify } from "@/utils/slugify";

type HtmlRenderResult = {
	html: string;
	headings: Heading[];
};

const ASSET_ATTRS: Record<string, string[]> = {
	img: ["src", "data-src", "data-large-src"],
	source: ["src", "srcset"],
	video: ["src", "poster"],
	audio: ["src"],
	script: ["src"],
	iframe: ["src"],
	link: ["href"],
};

const RELATIVE_PROTOCOL_REGEX = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/;

function isRelativePath(value: string): boolean {
	if (!value) return false;
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (trimmed.startsWith("/") || trimmed.startsWith("#") || trimmed.startsWith("?")) return false;
	if (trimmed.startsWith("//")) return false;
	if (trimmed.startsWith("data:") || trimmed.startsWith("mailto:") || trimmed.startsWith("tel:")) {
		return false;
	}
	return !RELATIVE_PROTOCOL_REGEX.test(trimmed);
}

function toPublicUrl(relativePath: string, descriptor: ExternalContentDescriptor): string {
	if (!relativePath) return relativePath;
	const [pathPart, suffix] = relativePath.split(/(?=[?#])/);
	const normalized = path.posix.normalize(pathPart.replace(/^.\//, ""));
	const joined = path.posix.join("/external-posts", descriptor.folderName, normalized);
	return suffix ? `${joined}${suffix}` : joined;
}

function rewriteSrcset(value: string, descriptor: ExternalContentDescriptor): string {
	return value
		.split(",")
		.map((entry) => {
			const trimmed = entry.trim();
			if (!trimmed) return trimmed;
			const [url, descriptorPart] = trimmed.split(/\s+/, 2);
			const rewritten = isRelativePath(url) ? toPublicUrl(url, descriptor) : url;
			return descriptorPart ? `${rewritten} ${descriptorPart}` : rewritten;
		})
		.join(", ");
}

function rewriteAssets(document: Element, descriptor: ExternalContentDescriptor) {
	const elements = DomUtils.findAll(
		(elem) => elem.type === "tag" && !!ASSET_ATTRS[elem.name],
		document.children,
		true,
	);

	for (const elem of elements) {
		const targetAttrs = ASSET_ATTRS[elem.name] || [];
		for (const attrName of targetAttrs) {
			const value = elem.attribs?.[attrName];
			if (!value) continue;

			if (attrName === "srcset") {
				elem.attribs[attrName] = rewriteSrcset(value, descriptor);
				continue;
			}

			if (isRelativePath(value)) {
				elem.attribs[attrName] = toPublicUrl(value, descriptor);
			}
		}
	}
}

function extractHeadings(document: Element): Heading[] {
	const headingTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
	const headingElements = DomUtils.findAll(
		(elem) => elem.type === "tag" && headingTags.has(elem.name),
		document.children,
		true,
	);

	return headingElements
		.map((elem) => {
			const depth = parseInt(elem.name.replace("h", ""), 10);
			const text = DomUtils.textContent(elem).trim();
			if (!text) {
				return null;
			}
			const existingId = elem.attribs?.id;
			const headingSlug = existingId || slugify(text);
			elem.attribs = {
				...elem.attribs,
				id: headingSlug,
			};
			return { text, slug: headingSlug, depth };
		})
		.filter(Boolean) as Heading[];
}

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

	const document = parseDocument(fileContents);
	rewriteAssets(document, descriptor);
	const headings = extractHeadings(document);

	const bodyElement = DomUtils.findOne(
		(elem) => elem.type === "tag" && elem.name === "body",
		document.children,
		true,
	);

	const html = bodyElement
		? DomUtils.getInnerHTML(bodyElement)
		: DomUtils.getOuterHTML(document);

	return {
		html,
		headings,
	};
}
