# Feature Plan: Author Handling (Multi-Select Authors with URLs/Photos)

## Goals (from user)
- Use a multi-select Authors property in Notion posts; fallback to default author from config when empty.
- Authors have optional URL and photo via shortcodes in select description; remaining text = bio.
- Byline: filter icon links to author page; author name links to URL (or author page if URL missing).
- Author pages are optional and suppressed when only the default author exists (if configured).
- Default author always applied when Authors property is empty.
- Surface authors everywhere they matter: hero, lists, gallery cards, **all post/detail pages (including stream/full previews), main/page templates**, RSS, OG, CiteThisPage, markdown export.

## Goals
- Multi-select Authors property in Notion posts.
- Shortcodes in select descriptions for URL and photo.
- Byline UX: filter icon links to author page; author name links to author URL (or author page if URL absent).
- Optional author pages; suppressed when only the default author exists.
- Fallback author from `site-info.authors.default-*`.
- Surfaced everywhere author info is used (hero, lists, gallery cards, RSS, OG, CiteThisPage, markdown export).

## Config (`constants-config.json5`)
```json5
"site-info": {
  authors: {
    "default-name": "Your Name",      // fallback when post Authors empty
    "default-url": "",                // optional; blank => link to home
    "default-photo": "",              // optional avatar URL
    "enable-author-pages": true,       // false => never build /authors
    "only-when-custom-authors": true   // if true: show bylines & build /authors only when a non-default author exists
  }
},
"shortcodes": {
  // existing shortcodes...
  "author-desc": {
    "url": "<<author-url>>",
    "photo": "<<author-photo-url>>"
  }
}
```
Notes:
- Fallback author always applied if Authors empty; no toggle.
- Photo is a URL (rendered directly).
- If URL missing and author pages enabled, name links to author page; else plain text.
- `only-when-custom-authors` also suppresses bylines when everyone is default.

## Data Model & Parsing
- Extend `Post` to include `Authors: { name; color; bio?; url?; photo? }[]`.
- In `src/lib/notion/client.ts`:
  - Parse Authors multi-select.
  - From description, extract URL (`<<author-url>>...<<author-url>>`), photo (`<<author-photo-url>>...`), bio = remainder stripped.
  - If Authors empty → synthesize from `site-info.authors` (url = default-url or home; photo optional).
- Helper `hasCustomAuthors()` to detect any non-default author.

## Author Pages (conditional)
- Routes:
  - `/authors/` index (list authors with counts, bio snippet, optional photo/link).
  - `/authors/[author]/[...page].astro` (paginate posts by author, tag-like).
- Build pages only if `enable-author-pages` AND (`only-when-custom-authors` is false OR `hasCustomAuthors()` true).

## Byline Rendering
- “By” + [filter icon] + author names.
  - Filter icon → author page (if pages enabled).
  - Name → author URL if present; else author page if enabled; else plain text.
- Update components:
  - `Hero.astro`, `PostPreview.astro`, `PostPreviewFull.astro`, `PostCard.astro` (gallery), page hero in `[...page].astro`.
- Consider shared `AuthorByline.astro` to avoid duplication.
- Avatars: show when `photo` exists (small chips); omit in gallery grid if needed for tightness.

## Other Surfaces to Update
- RSS: `src/pages/rss.xml.ts` (use authors array; fallback default).
- OG: `src/pages/og-image/[slug].png.ts` (joined authors string).
- Meta: `BaseHead.astro` `<meta name="author">` first author fallback default.
- CiteThisPage: `src/components/auto-added-sections/CiteThisPage.astro` (BibTeX author list).
- Markdown exporter: `src/integrations/markdown-exporter.ts` (frontmatter author(s)).
- Site config export: `src/site.config.ts` if needed.

## Rendering & Fallback Rules
- If `enable-author-pages` false: hide filter icon; names link to URL if present else plain text.
- If `only-when-custom-authors` true and all posts default: hide bylines and author pages.
- Ordering: preserve Notion multi-select order.
- Slugs: slugify author name.

## Image Behavior (authors & gallery)
- Author photos: remote URL, `<img loading="lazy">` (no extra download pipeline).
- Gallery cards: use FeaturedImage only; if missing → accent placeholder with initials; object-fit: cover; aspect 3:2.
- Hero background: prefers Cover else FeaturedImage; overlay handled in theme plan.

## Testing Checklist
- Multiple authors with URLs/photos: bylines correct; filter icon to author page; names to URLs.
- Authors without URL: names go to author page if enabled; else text.
- All-default + only-when-custom-authors: no bylines/pages.
- Author pages build/paginate; RSS/OG/CiteThisPage reflect authors; builds succeed when Authors property absent.

## Risks & Mitigations
- Missing Authors property: guard; always fallback to default.
- Bad shortcode: ignore; use remainder as bio.
- Duplicate author names: last wins; document uniqueness expectation.
- Hotlinked photos: acceptable; advise self-hosted URLs if desired.
