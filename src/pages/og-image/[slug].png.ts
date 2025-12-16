import type { APIContext, GetStaticPaths } from "astro";
import satori, { type SatoriOptions } from "satori";
import { Resvg } from "@resvg/resvg-js";
import { getFormattedDate } from "@/utils";
import { buildTimeFilePath } from "@/lib/blog-helpers";
import {
	getPostBySlug,
	getAllEntries,
	getAllTagsWithCounts,
	getAllAuthorsWithCounts,
	hasAuthorsProperty,
	hasCustomAuthors,
	downloadFile,
	generateFilePath,
} from "@/lib/notion/client";
import { getCollectionsWDesc } from "@/utils";

import { siteInfo } from "@/siteInfo";
import {
	OG_SETUP,
	LAST_BUILD_TIME,
	HOME_PAGE_SLUG,
	THEME,
	MENU_PAGES_COLLECTION,
	BUILD_FOLDER_PATHS,
	AUTHORS_CONFIG,
} from "@/constants";

import fs from "fs";
import sharp from "sharp";
import path from "path";

const rgbToHex = (rgb: string): string =>
	"#" +
	rgb
		.split(" ")
		.map((s) => parseInt(s).toString(16).padStart(2, "0"))
		.join("");

const rgbToRgba = (rgb: string, alpha: number): string =>
	`rgba(${rgb.split(" ").join(", ")}, ${alpha})`;

async function getFontFromGoogle(
	fontName: string,
	weight: number,
): Promise<SatoriOptions["fonts"][0]> {
	// Validate weight - must be between 100-900 and typically in increments of 100
	// If invalid, default to 400 (regular) or closest valid weight
	let validWeight = weight;
	if (weight < 100 || weight > 900 || !Number.isFinite(weight)) {
		console.warn(`Invalid font weight ${weight} for ${fontName}, defaulting to 400`);
		validWeight = 400;
	}

	// Build Google Fonts URL for specific font and weight
	const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${fontName.replace(/ /g, "+")}:wght@${validWeight}&display=swap`;

	// Fetch the CSS with a User-Agent that forces TTF (not WOFF2)
	const css = await fetch(googleFontsUrl, {
		headers: {
			// This User-Agent makes Google return TTF format which Satori supports
			"User-Agent":
				"Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
		},
	}).then((response) => response.text());

	// Extract font URL from CSS
	const match = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/);
	if (!match) {
		throw new Error(`Failed to find font URL for ${fontName} weight ${weight}`);
	}

	const fontUrl = match[1];

	// Download the font file
	const buffer = await fetch(fontUrl).then((response) => response.arrayBuffer());

	return {
		name: fontName,
		style: "normal",
		weight: weight,
		data: buffer,
	};
}

async function getOgFonts(): Promise<SatoriOptions["fonts"]> {
	const titleFontName = OG_SETUP["title-font-name"];
	const titleFontWeight = OG_SETUP["title-font-weight"] || 700;
	const footnoteFontName = OG_SETUP["footnote-font-name"];
	const footnoteFontWeight = OG_SETUP["footnote-font-weight"] || 700;

	const fonts: SatoriOptions["fonts"] = [];

	if (titleFontName) {
		fonts.push(await getFontFromGoogle(titleFontName, titleFontWeight));
	}

	if (footnoteFontName) {
		fonts.push(await getFontFromGoogle(footnoteFontName, footnoteFontWeight));
	}

	return fonts;
}

const titleFontFamily = OG_SETUP["title-font-name"] || "sans-serif";
const footnoteFontFamily = OG_SETUP["footnote-font-name"] || "monospace";

const og_images_colors = {
	backgroundColor: THEME["colors"]["bg"]["light"]
		? rgbToHex(THEME["colors"]["bg"]["light"])
		: "white",
	boxShadow:
		"5px 5px 0px " +
		(THEME["colors"]["accent-2"]["light"]
			? rgbToHex(THEME["colors"]["accent-2"]["light"])
			: "#374151"),
	border:
		"1px solid " +
		(THEME["colors"]["accent-2"]["light"]
			? rgbToHex(THEME["colors"]["accent-2"]["light"])
			: "#374151"),
	titleColor: THEME["colors"]["accent"]["light"]
		? rgbToHex(THEME["colors"]["accent"]["light"])
		: "#374151",
	descColor: THEME["colors"]["text"]["light"]
		? rgbToHex(THEME["colors"]["text"]["light"])
		: "#374151",
	infoColor: THEME["colors"]["quote"]["light"]
		? rgbToHex(THEME["colors"]["quote"]["light"])
		: "#374151",
	backgroundImage:
		"radial-gradient(circle at 25px 25px, " +
		(THEME["colors"]["accent-2"]["light"]
			? rgbToRgba(THEME["colors"]["accent-2"]["light"], 0.1)
			: "lightgray") +
		" 2%, transparent 0%),radial-gradient(circle at 75px 75px, " +
		(THEME["colors"]["accent-2"]["light"]
			? rgbToRgba(THEME["colors"]["accent-2"]["light"], 0.1)
			: "lightgray") +
		" 2%, transparent 0%)",
	maskImage:
		"linear-gradient(to bottom, " +
		(THEME["colors"]["bg"]["light"]
			? rgbToRgba(THEME["colors"]["bg"]["light"], 0.1)
			: "rgba(255, 255, 255, 0.1)") +
		" 30%, " +
		(THEME["colors"]["bg"]["light"]
			? rgbToRgba(THEME["colors"]["bg"]["light"], 0.1)
			: "rgba(255, 255, 255, 0.1)") +
		" 30%, " +
		(THEME["colors"]["bg"]["light"]
			? rgbToRgba(THEME["colors"]["bg"]["light"], 0.25)
			: "rgba(255, 255, 255, 0.25)") +
		" 80%, " +
		(THEME["colors"]["bg"]["light"]
			? rgbToRgba(THEME["colors"]["bg"]["light"], 0.1)
			: "rgba(255, 255, 255, 0.1)") +
		" 80%)",
};

//NOTE: INCOMPLETE, satori has issues with relative URLs

let customIconURL: string = "";
if (siteInfo.logo && siteInfo.logo.Type === "file") {
	try {
		const absolutePath = path.join(
			process.cwd(),
			"public",
			buildTimeFilePath(new URL(siteInfo.logo.Url)),
		);
		// console.log(siteInfo.logo.Url);
		customIconURL = absolutePath;
	} catch (err) {
		console.log("Invalid DB custom icon URL");
	}
}

// Function to convert image to base64
const logoToBase64 = async (imagePath: string) => {
	try {
		const ext = path.extname(imagePath).slice(1).toLowerCase();
		if (ext === "webp" || ext === "avif") return null;
		const buffer = await sharp(imagePath).resize(30, 30).toBuffer();
		return `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${buffer.toString("base64")}`;
	} catch (err) {
		console.error("Error processing the logo image:", err);
		return null;
	}
};

const logo_src =
	siteInfo.logo && siteInfo.logo.Type === "external"
		? siteInfo.logo.Url
		: siteInfo.logo && siteInfo.logo.Type === "file" && customIconURL
			? await logoToBase64(customIconURL)
			: null;

const isImageUrl = (url?: string) =>
	!!url &&
	(() => {
		try {
			const pathname = new URL(url).pathname.toLowerCase();
			return /\.(png|jpe?g|gif|webp|avif)$/i.test(pathname);
		} catch {
			return false;
		}
	})();

const toPngDataUrl = async (filepath: string): Promise<string | null> => {
	try {
		const buffer = await sharp(filepath).png().toBuffer();
		return `data:image/png;base64,${buffer.toString("base64")}`;
	} catch (err) {
		console.error("Error creating data URL:", err);
		return null;
	}
};

// For OG images: prefer existing local PNGs; otherwise download/convert via downloadFile.
// mode: "featured" (check public/notion cached file) | "author" (allow direct jpg/png URLs)
const normalizeOgImageSrc = async (
	urlStr: string | undefined,
	mode: "featured" | "author" = "featured",
): Promise<string | undefined> => {
	if (!urlStr) return undefined;
	try {
		const url = new URL(urlStr);
		const ext = path.extname(url.pathname).toLowerCase();

		const isPngLike = [".jpg", ".jpeg", ".png"].includes(ext);

		if (mode === "featured") {
			// Look for the cached/converted public file first
			const publicPath = generateFilePath(
				new URL(url.href.replace(ext || "", isPngLike ? ext : ".png")),
				false,
			);

			if (fs.existsSync(publicPath)) {
				const dataUrl = await toPngDataUrl(publicPath);
				return dataUrl || publicPath;
			}

			// Fallback: download/convert to public/notion
			const savedPath = await downloadFile(url, false, false, true);
			if (savedPath) {
				const dataUrl = await toPngDataUrl(savedPath);
				return dataUrl || savedPath;
			}

			return undefined;
		}

		// mode === "author"
		if (isPngLike) return urlStr; // remote jpg/png is acceptable

		const savedPath = await downloadFile(url, false, false, true);
		if (savedPath) {
			const dataUrl = await toPngDataUrl(savedPath);
			return dataUrl || savedPath;
		}

		return undefined;
	} catch (err) {
		console.error("Error normalizing OG image src:", err);
		return undefined;
	}
};

// Build the author block; shows logo if available, name only when non-empty
const buildAuthorInfo = (author: string, size: number) => {
	const children = [];

	if (logo_src) {
		children.push({
			type: "img",
			props: {
				src: logo_src,
				style: {
					height: `${size}px`,
					width: `${size}px`,
					objectFit: "contain",
					objectPosition: "center",
				},
			},
		});
	}

	if (author) {
		const names = author
			.split(",")
			.map((n) => n.trim())
			.filter((n) => n.length > 0);
		const count = names.length || 1;
		const fontSize =
			count > 2 ? Math.max(12, size - 8) : count === 2 ? Math.max(12, size - 4) : size;

		children.push({
			type: "span",
			props: {
				style: {
					marginRight: "16px",
					fontSize: `${fontSize}px`,
					fontFamily: footnoteFontFamily,
				},
				children: names.join(", "),
			},
		});
	}

	if (children.length === 0) return null;

	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				gap: "10px",
			},
			children,
		},
	};
};

const obj_img_sq_without_desc = function (
	title: string,
	pubDate: string,
	img_url: string,
	author: string,
) {
	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: og_images_colors["backgroundColor"],
			},
			children: [
				{
					type: "div",
					props: {
						style: {
							height: "100%",
							width: "100%",
							display: "flex",
							fontFamily: titleFontFamily,
						},
						children: [
							{
								type: "div",
								props: {
									style: {
										padding: "20px",
										display: "flex",
										width: "100%",
										height: "100%",
										justifyContent: "center",
										alignItems: "stretch",
									},
									children: [
										{
											type: "div",
											props: {
												style: {
													display: "flex",
													flexDirection: "row",
													justifyContent: "space-between",
													border: og_images_colors["border"],
													borderRadius: "8px",
													boxShadow: og_images_colors["boxShadow"],
													width: "100%",
													height: "100%",
													padding: "10px",
												},
												children: [
													{
														type: "div",
														props: {
															style: {
																display: "flex",
																flex: "1",
															},
															children: [
																{
																	type: "img",
																	props: {
																		src: img_url,
																		style: {
																			width: "100%",
																			height: "100%",
																			objectFit: "contain",
																			objectPosition: "center",
																		},
																		children: [],
																	},
																},
															],
														},
													},
													{
														type: "div",
														props: {
															style: {
																display: "flex",
																flexDirection: "column",
																flex: "1",
																marginLeft: "16px",
																paddingBottom: "44px",
															},
															children: [
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "42px",
																			fontWeight: "700",
																			lineHeight: "3rem",
																			padding: "10px 0 20px 0",
																			color: og_images_colors["titleColor"],
																			flex: "1",
																			display: "flex",
																			fontFamily: titleFontFamily,
																		},
																		children: title,
																	},
																},
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "16px",
																			fontWeight: "700",
																			color: og_images_colors["infoColor"],
																			display: "flex",
																			flexDirection: "row",
																			justifyContent: "space-between",
																			alignItems: "center",
																			fontFamily: footnoteFontFamily,
																		},
																		children: [
																			{
																				type: "div",
																				props: {
																					children: pubDate,
																				},
																			},
																			buildAuthorInfo(author, 40),
																		],
																	},
																},
															],
														},
													},
												],
											},
										},
									],
								},
							},
						],
					},
				},
			],
		},
	};
};

const obj_img_sq_with_desc = function (
	title: string,
	pubDate: string,
	desc: string,
	img_url: string,
	author: string,
) {
	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: og_images_colors["backgroundColor"],
			},
			children: [
				{
					type: "div",
					props: {
						style: {
							height: "100%",
							width: "100%",
							display: "flex",
							fontFamily: titleFontFamily,
						},
						children: [
							{
								type: "div",
								props: {
									style: {
										padding: "20px",
										display: "flex",
										width: "100%",
										height: "100%",
										justifyContent: "center",
										alignItems: "stretch",
									},
									children: [
										{
											type: "div",
											props: {
												style: {
													display: "flex",
													flexDirection: "row",
													justifyContent: "space-between",
													border: og_images_colors["border"],
													borderRadius: "8px",
													boxShadow: og_images_colors["boxShadow"],
													width: "100%",
													height: "100%",
													padding: "10px",
												},
												children: [
													{
														type: "div",
														props: {
															style: {
																display: "flex",
																flex: "1",
															},
															children: [
																{
																	type: "img",
																	props: {
																		src: img_url,
																		style: {
																			width: "100%",
																			height: "100%",
																			objectFit: "contain",
																			objectPosition: "center",
																		},
																		children: [],
																	},
																},
															],
														},
													},
													{
														type: "div",
														props: {
															style: {
																display: "flex",
																flexDirection: "column",
																flex: "1",
																marginLeft: "16px",
																paddingBottom: "44px",
															},
															children: [
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "32px",
																			fontWeight: "700",
																			lineHeight: "3rem",
																			padding: "10px 0 20px 0",
																			color: og_images_colors["titleColor"],
																			flex: "0.5",
																			display: "flex",
																			fontFamily: titleFontFamily,
																		},
																		children: title,
																	},
																},
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "24px",
																			fontWeight: "700",
																			lineHeight: "2rem",
																			padding: "10px 0 20px 0",
																			color: og_images_colors["descColor"],
																			flex: "1",
																			display: "flex",
																			fontFamily: footnoteFontFamily,
																		},
																		children: desc,
																	},
																},
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "16px",
																			fontWeight: "700",
																			color: og_images_colors["infoColor"],
																			display: "flex",
																			flexDirection: "row",
																			justifyContent: "space-between",
																			alignItems: "center",
																			fontFamily: footnoteFontFamily,
																		},
																		children: [
																			{
																				type: "div",
																				props: {
																					children: pubDate,
																				},
																			},
																			buildAuthorInfo(author, 30),
																		],
																	},
																},
															],
														},
													},
												],
											},
										},
									],
								},
							},
						],
					},
				},
			],
		},
	};
};

const obj_img_none_without_desc = function (title: string, pubDate: string, author: string) {
	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: og_images_colors["backgroundColor"],
			},
			children: [
				{
					type: "div",
					props: {
						style: {
							height: "100%",
							width: "100%",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "32px",
							fontWeight: "700",
							backgroundImage: og_images_colors["backgroundImage"],
							backgroundSize: "100px 100px",
							fontFamily: titleFontFamily,
						},
						children: [
							{
								type: "div",
								props: {
									style: {
										padding: "20px",
										display: "flex",
										width: "100%",
										height: "100%",
										justifyContent: "center",
										alignItems: "stretch",
									},
									children: [
										{
											type: "div",
											props: {
												style: {
													display: "flex",
													flexDirection: "row",
													justifyContent: "space-between",
													border: og_images_colors["border"],
													borderRadius: "8px",
													boxShadow: og_images_colors["boxShadow"],
													width: "100%",
													height: "100%",
												},
												children: [
													null,
													{
														type: "div",
														props: {
															style: {
																display: "flex",
																flexDirection: "column",
																flex: "1",
																paddingBottom: "44px",
															},
															children: [
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "64px",
																			fontWeight: "700",
																			lineHeight: "4rem",
																			padding: "20px 30px",
																			color: og_images_colors["titleColor"],
																			flex: "1",
																			display: "flex",
																		},
																		children: title,
																	},
																},
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "32px",
																			fontWeight: "700",
																			color: og_images_colors["infoColor"],
																			display: "flex",
																			flexDirection: "row",
																			justifyContent: "space-between",
																			alignItems: "center",
																			padding: "10px 30px",
																			fontFamily: footnoteFontFamily,
																		},
																		children: [
																			{
																				type: "div",
																				props: {
																					children: pubDate,
																				},
																			},
																			buildAuthorInfo(author, 30),
																		],
																	},
																},
															],
														},
													},
												],
											},
										},
									],
								},
							},
						],
					},
				},
			],
		},
	};
};

const obj_img_none_with_desc = function (
	title: string,
	pubDate: string,
	desc: string,
	author: string,
) {
	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: og_images_colors["backgroundColor"],
			},
			children: [
				{
					type: "div",
					props: {
						style: {
							height: "100%",
							width: "100%",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "32px",
							fontWeight: "700",
							backgroundImage: og_images_colors["backgroundImage"],
							backgroundSize: "100px 100px",
							fontFamily: titleFontFamily,
						},
						children: [
							{
								type: "div",
								props: {
									style: {
										padding: "20px",
										display: "flex",
										width: "100%",
										height: "100%",
										justifyContent: "center",
										alignItems: "stretch",
									},
									children: [
										{
											type: "div",
											props: {
												style: {
													display: "flex",
													flexDirection: "row",
													justifyContent: "space-between",
													border: og_images_colors["border"],
													borderRadius: "8px",
													boxShadow: og_images_colors["boxShadow"],
													width: "100%",
													height: "100%",
													padding: "10px",
												},
												children: [
													{
														type: "div",
														props: {
															style: {
																display: "flex",
																flexDirection: "column",
																flex: "1",
																paddingBottom: "44px",
															},
															children: [
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "52px",
																			fontWeight: "700",
																			lineHeight: "4rem",
																			padding: "20px 30px",
																			color: og_images_colors["titleColor"],
																			flex: "0.5",
																			display: "flex",
																		},
																		children: title,
																	},
																},
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "30px",
																			fontFamily: footnoteFontFamily,
																			fontWeight: "700",
																			lineHeight: "2rem",
																			padding: "10px 30px",
																			color: og_images_colors["descColor"],
																			flex: "1",
																			display: "flex",
																		},
																		children: desc,
																	},
																},
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "24px",
																			fontWeight: "700",
																			color: og_images_colors["infoColor"],
																			display: "flex",
																			flexDirection: "row",
																			justifyContent: "space-between",
																			alignItems: "center",
																			padding: "10px 20px",
																			fontFamily: footnoteFontFamily,
																		},
																		children: [
																			{
																				type: "div",
																				props: {
																					children: pubDate,
																				},
																			},
																			buildAuthorInfo(author, 30),
																		],
																	},
																},
															],
														},
													},
												],
											},
										},
									],
								},
							},
						],
					},
				},
			],
		},
	};
};

const obj_img_bg = function (title: string, pubDate: string, img_url: string, author: string) {
	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				width: "100%",
				height: "100%",
				backgroundColor: og_images_colors["backgroundColor"],
				position: "relative",
			},
			children: [
				{
					type: "div",
					props: {
						style: {
							height: "100%",
							width: "100%",
							display: "flex",
							flexDirection: "column",
							alignItems: "center",
							justifyContent: "center",
							fontSize: "32px",
							fontWeight: "700",
							fontFamily: titleFontFamily,
						},
						children: [
							{
								type: "img",
								props: {
									src: img_url,
									style: {
										position: "absolute",
										top: "0",
										left: "0",
										height: "100%",
										width: "100%",
										maskImage: og_images_colors["maskImage"],
										objectFit: "cover",
									},
									children: [],
								},
							},
							{
								type: "div",
								props: {
									style: {
										padding: "20px",
										display: "flex",
										width: "100%",
										height: "100%",
										justifyContent: "center",
										alignItems: "stretch",
									},
									children: [
										{
											type: "div",
											props: {
												style: {
													display: "flex",
													flexDirection: "row",
													justifyContent: "space-between",
													border: og_images_colors["border"],
													borderRadius: "8px",
													boxShadow: og_images_colors["boxShadow"],
													width: "100%",
													height: "100%",
													padding: "10px",
												},
												children: [
													null,
													{
														type: "div",
														props: {
															style: {
																display: "flex",
																flexDirection: "column",
																flex: "1",
																paddingBottom: "44px",
															},
															children: [
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "48px",
																			fontWeight: "700",
																			lineHeight: "3rem",
																			padding: "10px 20px",
																			color: og_images_colors["titleColor"],
																			flex: "1",
																			display: "flex",
																		},
																		children: title,
																	},
																},
																{
																	type: "div",
																	props: {
																		style: {
																			fontSize: "24px",
																			fontWeight: "700",
																			color: og_images_colors["infoColor"],
																			display: "flex",
																			flexDirection: "row",
																			justifyContent: "space-between",
																			alignItems: "center",
																			fontFamily: footnoteFontFamily,
																			padding: "10px 20px",
																		},
																		children: [
																			{
																				type: "div",
																				props: {
																					children: pubDate,
																				},
																			},
																			buildAuthorInfo(author, 30),
																		],
																	},
																},
															],
														},
													},
												],
											},
										},
									],
								},
							},
						],
					},
				},
			],
		},
	};
};

export async function GET(context: APIContext) {
	const {
		params: { slug },
		props,
	} = context;
	const BASE_DIR = BUILD_FOLDER_PATHS["ogImages"];
	let keyStr = slug;
	let type = "postpage";
	if (keyStr?.includes("---")) {
		keyStr = slug.split("---")[1];
		type = slug.split("---")[0];
	}
	let post = null;
	let postLastUpdatedBeforeLastBuild = true;

	if (type == "postpage") {
		post = await getPostBySlug(keyStr!);
		postLastUpdatedBeforeLastBuild = LAST_BUILD_TIME
			? post?.LastUpdatedTimeStamp
				? post?.LastUpdatedTimeStamp < LAST_BUILD_TIME
				: false
			: false;
	}

	// Load fonts from Google (TTF format for Satori compatibility)
	const fonts = await getOgFonts();
	const ogOptions: SatoriOptions = {
		width: 1200,
		height: 630,
		fonts,
	};

	const imagePath = path.join(BASE_DIR, `${slug}.png`);

	if (fs.existsSync(imagePath) && postLastUpdatedBeforeLastBuild) {
		// Read the existing image and send it in the response
		const existingImage = fs.readFileSync(imagePath);
		return new Response(existingImage, {
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		});
	}

	let chosen_markup;
	let fallback_markup;
	let author = siteInfo.author?.trim() || "";

	const authorsPropertyExists = await hasAuthorsProperty();

	if (type == "postpage") {
		const title = post?.Title
			? post.Slug == HOME_PAGE_SLUG
				? siteInfo.title
				: post.Title
			: siteInfo.title;
		const postDate =
			post?.Slug == HOME_PAGE_SLUG ||
			(post?.Collection && MENU_PAGES_COLLECTION.includes(post?.Collection))
				? ""
				: getFormattedDate(post?.Date ?? post?.Date ?? Date.now());
		const postAuthors =
			authorsPropertyExists && post?.Authors && post.Authors.length > 0
				? post.Authors.map((a) => a.name).join(", ")
				: "";

		author = post?.Slug == HOME_PAGE_SLUG ? "" : postAuthors || author;

		const normalizedFeaturedUrl = await normalizeOgImageSrc(post?.FeaturedImage?.Url);
		const hasFeaturedImage =
			!!normalizedFeaturedUrl &&
			(!post?.FeaturedImage?.ExpiryTime || Date.parse(post?.FeaturedImage.ExpiryTime) > Date.now());

		if (OG_SETUP["columns"] == 1 && hasFeaturedImage) {
			chosen_markup = obj_img_bg(title, postDate, normalizedFeaturedUrl!, author);
		} else if (OG_SETUP["columns"] && hasFeaturedImage) {
			chosen_markup =
				post?.Excerpt && OG_SETUP["excerpt"]
					? obj_img_sq_with_desc(title, postDate, post?.Excerpt, normalizedFeaturedUrl!, author)
					: obj_img_sq_without_desc(title, postDate, normalizedFeaturedUrl!, author);
		} else {
			chosen_markup =
				post?.Excerpt && OG_SETUP["excerpt"]
					? obj_img_none_with_desc(title, postDate, post?.Excerpt, author)
					: obj_img_none_without_desc(title, postDate, author);
		}
		fallback_markup = post?.Excerpt
			? obj_img_none_with_desc(title, postDate, post?.Excerpt, author)
			: obj_img_none_without_desc(title, postDate, author);
	} else if (type == "collectionpage") {
		const collectionDescription = (props as any)?.description || "";
		const byline = siteInfo.title || author;
		chosen_markup = collectionDescription
			? obj_img_none_with_desc(
					keyStr + " : " + "A collection of posts",
					" ",
					collectionDescription,
					byline,
				)
			: obj_img_none_without_desc(keyStr + " : " + "A collection of posts", " ", byline);
	} else if (type == "tagsindex") {
		const byline = siteInfo.title || author;
		chosen_markup = obj_img_none_without_desc("All topics I've written about", " ", byline);
	} else if (type == "collectionsindex") {
		const byline = siteInfo.title || author;
		chosen_markup = obj_img_none_without_desc("All collections that hold my posts", " ", byline);
	} else if (type == "tagpage") {
		const tagDescription = (props as any)?.description || "";
		const byline = siteInfo.title || author;
		chosen_markup = tagDescription
			? obj_img_none_with_desc("All posts tagged with #" + keyStr, " ", tagDescription, byline)
			: obj_img_none_without_desc("All posts tagged with #" + keyStr, " ", byline);
	} else if (type == "authorpage") {
		const authorDescription = (props as any)?.description || "";
		const authorPhoto = (props as any)?.photo as string | undefined;
		if (authorPhoto && isImageUrl(authorPhoto)) {
			const normalizedPhoto = await normalizeOgImageSrc(authorPhoto, "author");
			if (normalizedPhoto) {
				chosen_markup = authorDescription
					? obj_img_sq_with_desc(
							"Posts by " + keyStr,
							" ",
							authorDescription,
							normalizedPhoto,
							"",
						)
					: obj_img_sq_without_desc("Posts by " + keyStr, " ", normalizedPhoto, "");
			} else {
				chosen_markup = authorDescription
					? obj_img_none_with_desc("Posts by " + keyStr, " ", authorDescription, "")
					: obj_img_none_without_desc("Posts by " + keyStr, " ", "");
			}
		} else {
			chosen_markup = authorDescription
				? obj_img_none_with_desc("Posts by " + keyStr, " ", authorDescription, "")
				: obj_img_none_without_desc("Posts by " + keyStr, " ", "");
		}
	} else if (type == "authorsindex") {
		chosen_markup = obj_img_none_without_desc("All Authors", " ", "");
	} else {
		chosen_markup = obj_img_none_without_desc("All posts in one place", " ", author);
	}

	// const svg = await satori(chosen_markup, ogOptions);
	let svg;
	try {
		svg = await satori(chosen_markup, ogOptions);
	} catch (error) {
		console.error("Error in satori:", error);
		// Fallback to a basic markup if satori fails
		svg = await satori(fallback_markup, ogOptions);
	}
	const pngBuffer = new Resvg(svg).render().asPng();
	// Check if the buffer size is greater than 100 KB (102400 bytes)
	if (pngBuffer.length > 102400) {
		// Optimize the PNG using Sharp if it's larger than 100 KB
		await sharp(pngBuffer)
			.png({ quality: 80 }) // Adjust quality as needed
			.toFile(imagePath);
	} else {
		// Save the image as is if it's smaller than 100 KB
		fs.writeFileSync(imagePath, pngBuffer);
	}

	return new Response(pngBuffer, {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=31536000, immutable",
		},
	});
}

export const getStaticPaths: GetStaticPaths = async () => {
	const posts = (await getAllEntries()).filter((entry) => !entry.IsExternal);

	const postsMap = posts.map(({ Slug }) => ({ params: { slug: Slug } }));

	const collectionsWDesc = await getCollectionsWDesc();
	const collectionMap = collectionsWDesc.map((collection) => ({
		params: { slug: "collectionpage---" + collection.name },
		props: { description: collection.description },
	}));

	const allTags = await getAllTagsWithCounts();
	const tagMap = allTags.map((tag) => ({
		params: { slug: "tagpage---" + tag.name },
		props: { description: tag.description },
	}));

	// Author pages OG images (only when author pages are enabled and authors property exists)
	let authorMap: { params: { slug: string }; props?: { description?: string; photo?: string } }[] =
		[];
	let authorsindex: { params: { slug: string } } | null = null;

	const authorsPropertyExists = await hasAuthorsProperty();
	const includeAuthorPages =
		AUTHORS_CONFIG.enableAuthorPages &&
		authorsPropertyExists &&
		(!AUTHORS_CONFIG.onlyWhenCustomAuthors || (await hasCustomAuthors()));

	if (includeAuthorPages) {
		const allAuthors = await getAllAuthorsWithCounts();
		authorMap = allAuthors.map((author) => ({
			params: { slug: "authorpage---" + author.name },
			props: { description: author.bio || "", photo: author.photo },
		}));
		authorsindex = { params: { slug: "authorsindex---index" } };
	}

	const tagsindex = { params: { slug: "tagsindex---index" } };
	const postsindex = { params: { slug: "postsindex---index" } };
	const collectionsindex = { params: { slug: "collectionsindex---index" } };

	return [
		...postsMap,
		...collectionMap,
		...tagMap,
		...authorMap,
		tagsindex,
		postsindex,
		collectionsindex,
		...(authorsindex ? [authorsindex] : []),
	];
};
