import type { AstroIntegration, AstroIntegrationLogger } from "astro";
import fs from "node:fs";
import path from "node:path";
import {
	EXTERNAL_CONTENT_CONFIG,
	EXTERNAL_CONTENT_PATHS,
	type ExternalContentSourceConfig,
	type ExternalContentCustomComponentConfig,
} from "../constants";

type ManifestEntryKind = "content" | "custom-components";

type ManifestEntry = {
	sha: string;
	sourceId: string;
	folderName: string;
	repo: string;
	owner: string;
	ref: string;
	path: string;
	lastFetched: string;
	kind: ManifestEntryKind;
	hasAssets?: boolean;
};

type ManifestFile = {
	version: number;
	entries: Record<string, ManifestEntry>;
};

type GitHubContentEntry = {
	type: string;
	name: string;
	path: string;
	sha: string;
	download_url: string | null;
	url: string;
};

const MANIFEST_VERSION = 1;
const GITHUB_API_BASE = "https://api.github.com";
const CONTENT_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".html", ".htm"]);
const RAW_HEADERS = {
	Accept: "application/vnd.github+json",
	"User-Agent": "webtrotion-external-content",
};

const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

function ensureDir(dirPath: string) {
	if (!dirPath) return;
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

function readManifest(): ManifestFile {
	ensureDir(EXTERNAL_CONTENT_PATHS.manifestDir);
	if (!fs.existsSync(EXTERNAL_CONTENT_PATHS.manifestFile)) {
		return { version: MANIFEST_VERSION, entries: {} };
	}

	try {
		const data = fs.readFileSync(EXTERNAL_CONTENT_PATHS.manifestFile, "utf-8");
		const parsed = JSON.parse(data);
		if (parsed.version !== MANIFEST_VERSION || typeof parsed.entries !== "object") {
			return { version: MANIFEST_VERSION, entries: {} };
		}
		return parsed as ManifestFile;
	} catch (error) {
		console.warn("[external-content] Failed to parse manifest. Rebuilding cache.", error);
		return { version: MANIFEST_VERSION, entries: {} };
	}
}

function writeManifest(nextManifest: ManifestFile) {
	ensureDir(EXTERNAL_CONTENT_PATHS.manifestDir);
	fs.writeFileSync(
		EXTERNAL_CONTENT_PATHS.manifestFile,
		JSON.stringify(nextManifest, null, 2),
		"utf-8",
	);
}

function encodeGitHubPath(input: string): string {
	return input
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function buildContentsUrl(owner: string, repo: string, pathInRepo: string, ref: string): string {
	const encodedPath = encodeGitHubPath(pathInRepo);
	const pathSuffix = encodedPath ? `/${encodedPath}` : "";
	return `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents${pathSuffix}?ref=${encodeURIComponent(ref)}`;
}

async function fetchFromGitHub(url: string): Promise<Response> {
	const headers: Record<string, string> = { ...RAW_HEADERS };
	if (githubToken) {
		headers.Authorization = `Bearer ${githubToken}`;
	}
	return await fetch(url, { headers });
}

async function fetchDirectoryEntries(
	source: ExternalContentSourceConfig | ExternalContentCustomComponentConfig,
	dirPath: string,
	logger: AstroIntegrationLogger,
): Promise<GitHubContentEntry[] | null> {
	const url = buildContentsUrl(source.owner, source.repo, dirPath, source.ref);
	const response = await fetchFromGitHub(url);

	if (response.status === 404) {
		logger.warn(`[external-content] GitHub path "${dirPath}" not found in ${source.repo}.`);
		return null;
	}

	if (!response.ok) {
		logger.warn(
			`[external-content] GitHub API request failed (${response.status}) while reading ${dirPath}.`,
		);
		return null;
	}

	const payload = (await response.json()) as GitHubContentEntry[] | Record<string, any>;
	if (!Array.isArray(payload)) {
		logger.warn(`[external-content] Expected directory listing for "${dirPath}", received object.`);
		return null;
	}
	return payload;
}

async function downloadFile(
	entry: GitHubContentEntry,
	destDir: string,
	logger: AstroIntegrationLogger,
): Promise<void> {
	const destPath = path.join(destDir, entry.name);
	ensureDir(path.dirname(destPath));

	const finalUrl = entry.download_url || entry.url;
	const response = await fetchFromGitHub(finalUrl);

	if (!response.ok) {
		logger.warn(
			`[external-content] Failed to download file "${entry.path}" (status ${response.status}).`,
		);
		return;
	}

	if (entry.download_url) {
		const buffer = Buffer.from(await response.arrayBuffer());
		fs.writeFileSync(destPath, buffer);
		return;
	}

	const data = await response.json();
	if (typeof data?.content === "string" && data.encoding === "base64") {
		const buffer = Buffer.from(data.content, "base64");
		fs.writeFileSync(destPath, buffer);
		return;
	}

	logger.warn(`[external-content] Unsupported response while downloading "${entry.path}".`);
}

async function downloadFolderRecursive(
	source: ExternalContentSourceConfig | ExternalContentCustomComponentConfig,
	dirPath: string,
	targetDir: string,
	logger: AstroIntegrationLogger,
): Promise<void> {
	ensureDir(targetDir);
	const entries = await fetchDirectoryEntries(source, dirPath, logger);
	if (!entries) {
		return;
	}

	for (const entry of entries) {
		if (entry.type === "dir") {
			await downloadFolderRecursive(source, entry.path, path.join(targetDir, entry.name), logger);
		} else if (entry.type === "file") {
			await downloadFile(entry, targetDir, logger);
		} else {
			logger.debug?.(
				`[external-content] Skipping unsupported GitHub entry "${entry.path}" (${entry.type}).`,
			);
		}
	}
}

function copyDirectory(src: string, dest: string) {
	if (!fs.existsSync(src)) {
		return;
	}

	fs.rmSync(dest, { recursive: true, force: true });
	ensureDir(path.dirname(dest));
	fs.cpSync(src, dest, { recursive: true });
}

function copyAssetsToPublic(src: string, dest: string): boolean {
	if (!fs.existsSync(src)) {
		fs.rmSync(dest, { recursive: true, force: true });
		return false;
	}

	fs.rmSync(dest, { recursive: true, force: true });
	let copiedAny = false;

	const walk = (currentSrc: string, currentDest: string) => {
		const entries = fs.readdirSync(currentSrc, { withFileTypes: true });
		for (const entry of entries) {
			const srcPath = path.join(currentSrc, entry.name);
			const destPath = path.join(currentDest, entry.name);
			if (entry.isDirectory()) {
				walk(srcPath, destPath);
			} else if (entry.isFile()) {
				const ext = path.extname(entry.name).toLowerCase();
				if (CONTENT_EXTENSIONS.has(ext)) {
					continue;
				}
				ensureDir(path.dirname(destPath));
				fs.copyFileSync(srcPath, destPath);
				copiedAny = true;
			}
		}
	};

	walk(src, dest);

	if (!copiedAny) {
		fs.rmSync(dest, { recursive: true, force: true });
	}

	return copiedAny;
}

function removeLocalCopies(entry: ManifestEntry) {
	const stagingDir = path.join(EXTERNAL_CONTENT_PATHS.tmpRoot, entry.sourceId, entry.folderName);
	const externalPostsDir = path.join(EXTERNAL_CONTENT_PATHS.externalPosts, entry.folderName);
	const publicAssetsDir = path.join(EXTERNAL_CONTENT_PATHS.publicAssets, entry.folderName);

	fs.rmSync(stagingDir, { recursive: true, force: true });
	fs.rmSync(externalPostsDir, { recursive: true, force: true });
	fs.rmSync(publicAssetsDir, { recursive: true, force: true });
}

function removeCustomComponentCopies() {
	const stagingDir = path.join(EXTERNAL_CONTENT_PATHS.tmpRoot, "custom-components");
	fs.rmSync(stagingDir, { recursive: true, force: true });
	fs.rmSync(EXTERNAL_CONTENT_PATHS.customComponents, { recursive: true, force: true });
}

async function handleContentSource(
	source: ExternalContentSourceConfig,
	manifest: ManifestFile,
	logger: AstroIntegrationLogger,
): Promise<void> {
	const sourcePath = source.path;
	const listing = await fetchDirectoryEntries(source, sourcePath, logger);
	if (!listing) {
		return;
	}

	const remoteFolders = listing.filter((entry) => entry.type === "dir");
	const existingKeys = new Set<string>();

	for (const folder of remoteFolders) {
		const manifestKey = `post:${source.id}:${folder.name}`;
		existingKeys.add(manifestKey);

		const currentEntry = manifest.entries[manifestKey];
		const externalPostsDir = path.join(EXTERNAL_CONTENT_PATHS.externalPosts, folder.name);
		const publicAssetsDir = path.join(EXTERNAL_CONTENT_PATHS.publicAssets, folder.name);
		const hasDestCopy = fs.existsSync(externalPostsDir);
		const expectedAssets = currentEntry?.hasAssets === true;
		const hasAssetsCopy = expectedAssets ? fs.existsSync(publicAssetsDir) : true;

		if (currentEntry && currentEntry.sha === folder.sha && hasDestCopy && hasAssetsCopy) {
			continue;
		}

		logger.info(
			`[external-content] Syncing ${source.id}/${folder.name} (${folder.sha.slice(0, 7)})`,
		);
		const stagingDir = path.join(EXTERNAL_CONTENT_PATHS.tmpRoot, source.id, folder.name);
		fs.rmSync(stagingDir, { recursive: true, force: true });
		await downloadFolderRecursive(source, folder.path, stagingDir, logger);

		copyDirectory(stagingDir, externalPostsDir);
		const hasAssets = copyAssetsToPublic(stagingDir, publicAssetsDir);

		manifest.entries[manifestKey] = {
			sha: folder.sha,
			sourceId: source.id,
			folderName: folder.name,
			repo: source.repo,
			owner: source.owner,
			ref: source.ref,
			path: folder.path,
			lastFetched: new Date().toISOString(),
			kind: "content",
			hasAssets,
		};
	}

	for (const [key, entry] of Object.entries(manifest.entries)) {
		if (entry.kind !== "content" || entry.sourceId !== source.id) {
			continue;
		}
		if (!existingKeys.has(key)) {
			logger.info(`[external-content] Removing stale folder ${source.id}/${entry.folderName}`);
			removeLocalCopies(entry);
			delete manifest.entries[key];
		}
	}
}

async function handleCustomComponents(
	config: ExternalContentCustomComponentConfig,
	manifest: ManifestFile,
	logger: AstroIntegrationLogger,
): Promise<void> {
	const manifestKey = "custom-components";
	const entries = await fetchDirectoryEntries(config, config.path, logger);
	if (!entries) {
		return;
	}

	const folderSha = entries
		.map((entry) => `${entry.name}:${entry.sha}`)
		.sort()
		.join("|");

	const currentEntry = manifest.entries[manifestKey];
	const componentsDest = EXTERNAL_CONTENT_PATHS.customComponents;
	const hasComponents = fs.existsSync(componentsDest) && fs.readdirSync(componentsDest).length > 0;
	if (currentEntry && currentEntry.sha === folderSha) {
		if (!hasComponents) {
			// Dest missing but manifest up-to-date; trigger a re-download
		} else {
			return;
		}
	}

	logger.info("[external-content] Syncing custom components");
	const stagingDir = path.join(EXTERNAL_CONTENT_PATHS.tmpRoot, "custom-components");
	fs.rmSync(stagingDir, { recursive: true, force: true });
	await downloadFolderRecursive(config, config.path, stagingDir, logger);

	copyDirectory(stagingDir, componentsDest);

	manifest.entries[manifestKey] = {
		sha: folderSha,
		sourceId: "custom-components",
		folderName: "custom-components",
		repo: config.repo,
		owner: config.owner,
		ref: config.ref,
		path: config.path,
		lastFetched: new Date().toISOString(),
		kind: "custom-components",
	};
}

async function runExternalContentSync(logger: AstroIntegrationLogger) {
	if (!EXTERNAL_CONTENT_CONFIG.enabled) {
		return;
	}

	ensureDir(EXTERNAL_CONTENT_PATHS.tmpRoot);
	ensureDir(EXTERNAL_CONTENT_PATHS.externalPosts);
	ensureDir(EXTERNAL_CONTENT_PATHS.customComponents);
	ensureDir(EXTERNAL_CONTENT_PATHS.publicAssets);

	const manifest = readManifest();

	for (const source of EXTERNAL_CONTENT_CONFIG.sources) {
		try {
			await handleContentSource(source, manifest, logger);
		} catch (error) {
			logger.warn(
				`[external-content] Failed to sync source "${source.id}": ${(error as Error).message}`,
			);
		}
	}

	if (EXTERNAL_CONTENT_CONFIG.customComponents) {
		try {
			await handleCustomComponents(EXTERNAL_CONTENT_CONFIG.customComponents, manifest, logger);
		} catch (error) {
			logger.warn(
				`[external-content] Failed to sync custom components: ${(error as Error).message}`,
			);
		}
	} else {
		removeCustomComponentCopies();
		delete manifest.entries["custom-components"];
	}

	writeManifest(manifest);
}

export default function externalContentDownloader(): AstroIntegration {
	return {
		name: "external-content-downloader",
		hooks: {
			"astro:build:start": async ({ logger }) => {
				await runExternalContentSync(logger);
			},
			"astro:dev:start": async ({ logger }) => {
				await runExternalContentSync(logger);
			},
		},
	};
}
