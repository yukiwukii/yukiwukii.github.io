# Citations Feature Implementation Plan

**Version**: 2.0 (Concise)
**Date**: 2025-10-26
**Estimated Time**: 3-4 hours
**Files**: 5 new, 8 modified

---

## Overview

Add academic citations support to Webtrotion:
- Fetch BibTeX files from external sources (GitHub, Dropbox, Drive)
- Support `[@key]`, `\cite{key}`, `#cite(key)` formats in Notion content
- Generate formatted bibliographies (APA or IEEE)
- Display citation info in popups/margins like footnotes

### Key Difference from Footnotes

**Footnotes**: Each marker unique → shows once → single backlink `↩`
**Citations**: Same key repeats → shows multiple times → multiple symbol backlinks `[‡][§][Δ]`

**Bibliography Format:**
```
IEEE: [1] Smith, J. et al. (2020). Paper title... at [‡][§][Δ]
      [2] Jones, M. (2019). Another title... at [‡]
      [3] Anderson, T. (2021). Third paper... at [‡][§]
      ⟹ Sorted by ORDER OF FIRST OCCURRENCE in text

APA:  Anderson, T. (2021). Third paper... at [‡][§]
      Jones, M. (2019). Another title... at [‡]
      Smith, J. et al. (2020). Paper title... at [‡][§][Δ]
      ⟹ Sorted ALPHABETICALLY by first author
```

Where each symbol is a clickable backlink to that occurrence (like interlinked content).

---

## Architecture

Follow the **footnotes pattern exactly**:
1. Process at build time in `_buildBlock()`
2. Cache everything (BibTeX files, per-page citations)
3. Components just render pre-processed data
4. Reuse margin notes and popover systems

**Critical Implementation Notes**:
1. **Processing order**: Extract citations BEFORE footnotes in `_buildBlock()` - footnote content can have citations!
2. **Collection**: Do NOT traverse blocks again. Citations are extracted during `_buildBlock()`, so just collect from `block.Citations[]` arrays (like `footnotesInPage` does).

---

## Phase 1: Type Definitions

### File: `src/lib/interfaces.ts`

Add `Citation` interface:
```typescript
interface Citation {
  Key: string;                  // "smith2020"
  Index?: number;               // 1, 2, 3... (IEEE only)
  FormattedEntry: string;       // HTML from citation-js
  Authors: string;              // "Smith et al."
  Year: string;                 // "2020"
  SourceBlockIds: string[];     // ARRAY of all blocks where key appears
  FirstAppearanceIndex?: number;
}
```

**Key point**: `SourceBlockIds` is an ARRAY because same key can appear multiple times.

Also add: `CitationsConfig`, `BibSourceInfo`, `BibFileMeta`, `CitationExtractionResult`

Update `Block` interface: add `Citations?: Citation[]`
Update `RichText` interface: add `IsCitationMarker?: boolean` and `CitationRef?: string`

### File: `src/constants.ts`

Add exports:
```typescript
export const CITATIONS = key_value_from_json?.citations || null;
export const CITATIONS_ENABLED = CITATIONS?.["extract-and-process-bibtex-citations"]?.enabled === true;
export const BIBLIOGRAPHY_STYLE = ... // "apa" or "simplified-ieee"
```

Add cache paths:
```typescript
BUILD_FOLDER_PATHS = {
  ...existing,
  citationsInPage: path.join("./tmp", "blocks-json-cache", "citations-in-page"),
  bibFilesCache: path.join("./tmp", "bib-files-cache"),
}
```

---

## Phase 2: BibTeX Processing

### New File: `src/lib/citations.ts` (~600-800 lines)

This file contains ALL citation logic. Key functions:

#### 1. URL Normalization

Function: `get_bib_source_info(url)` → Returns `{ source, download_url, updated_url, updated_instructions }`

Handle 4 source types with examples:

**GitHub Gist**:
- Input: `https://gist.github.com/nerdymomocat/dd0ea3c71898e6d7557d0b2a6b0f95f5`
- Download: `https://gist.githubusercontent.com/nerdymomocat/dd0ea3c71898e6d7557d0b2a6b0f95f5/raw`
- Updated: `https://api.github.com/gists/dd0ea3c71898e6d7557d0b2a6b0f95f5`
- Timestamp: `curl -s <updated_url> | jq '.updated_at'`

**GitHub Repo File**:
- Input: `https://github.com/user/repo/blob/main/file.bib`
- Download: `https://raw.githubusercontent.com/user/repo/main/file.bib`
- Updated: `https://api.github.com/repos/user/repo/commits?path=file.bib`
- Timestamp: `curl -s <updated_url> | jq '.[0].commit.committer.date'`

**Dropbox**:
- Input: `https://www.dropbox.com/scl/fi/.../file.bib?dl=0`
- Download: Change `dl=0` → `dl=1`
- Updated: None (no public timestamp)

**Google Drive**:
- Input: `https://drive.google.com/file/d/FILE_ID/view`
- Download: `https://drive.google.com/uc?export=download&id=FILE_ID`
- Updated: None (no public timestamp)

#### 2. File Fetching with Caching

Function: `fetchBibTeXFile(url)` → Returns file content string

Strategy:
- Check if cached file exists
- For GitHub: call `updated_url` API to get last-modified timestamp
- If file unchanged since cache, return cached version
- Otherwise fetch fresh, save to `tmp/bib-files-cache/{hash}.bib` + metadata

#### 3. BibTeX Parsing

Function: `parseBibTeXFiles(urls)` → Returns `Map<key, entry>`

- Use `citation-js` library to parse .bib files
- Merge all entries from multiple files into single map
- Log entry count

#### 4. Citation Formatting

Function: `formatCitation(entry, style)` → Returns `{ inText, bibliography, authors, year }`

- For IEEE: Return `[1]` for inText, formatted entry from citation-js
- For APA: Return `[Author et al., Year]` for inText, formatted entry
- Cap authors at 8 before "et al."

#### 5. Extract from Block

Function: `extractCitationsFromBlock(block, config, bibEntries)` → Returns `{ citations, processedRichTexts }`

Process:
1. Get all RichText locations from block (reuse footnotes function)
2. Find citation markers with regex based on format (`[@key]`, etc.)
3. For each match: Look up key in bibEntries, format it, create Citation object
4. Split RichText at markers, set `IsCitationMarker=true` and `CitationRef=key`
5. Return array of citations

**Important**: Each citation at this stage has empty `SourceBlockIds: []` - will be populated later.

#### 6. Extract from Page

Function: `extractCitationsInPage(blocks, style)` → Returns `Citation[]`

**CRITICAL - Do NOT traverse**:
```typescript
// NO: traverse(blocks) and recurse into children
// YES: Just iterate flat array
blocks.forEach(block => {
  if (block.Citations) {
    // Group by Key, collect block IDs
  }

  // Also check footnote content blocks (citations inside footnotes)
  if (block.Footnotes) {
    footnote.Content.Blocks?.forEach(fnBlock => {
      if (fnBlock.Citations) { ... }
    })
  }
})
```

Group by Key:
- First time seeing key → create Citation, assign `Index = firstAppearanceCounter++` (for IEEE), add to map
- Subsequent times → add block.Id to existing Citation's SourceBlockIds array

This ensures IEEE numbering follows order of first occurrence: if `[@smith2020]` appears first, it gets [1], if `[@jones2019]` appears second, it gets [2], etc.

Return one Citation object per unique key with all block IDs collected.

#### 7. Prepare Bibliography

Function: `prepareBibliography(citations, style)` → Returns sorted `Citation[]`

- Citations already deduplicated by `extractCitationsInPage()`
- **IEEE**: Sort by `Index` field (order of first occurrence) - so [1] is the first citation mentioned, [2] is the second, etc.
- **APA**: Sort alphabetically by `Authors` field

---

## Phase 3: Client Integration

### File: `src/lib/notion/client.ts`

#### 1. Module-level cache

Add at top:
```typescript
let bibEntriesCache: Map<string, any> | null = null;
let bibCacheInitialized = false;
```

#### 2. Initialize BibTeX at build start

Function: `ensureBibTeXInitialized()`

- Call ONCE at start of build
- Fetch and parse all BibTeX files from config
- Store in `bibEntriesCache`
- Log count

Call this in `getAllBlocksByBlockId()` before processing any blocks.

#### 3. Add to `_buildBlock()`

**CRITICAL: Process citations BEFORE footnotes!**

Footnote content can contain citations, so we must extract and replace citation markers first.

```typescript
// Process citations FIRST (before footnotes)
if (CITATIONS_ENABLED && bibEntriesCache) {
  const result = await extractCitationsFromBlock(block, CITATIONS, bibEntriesCache);
  if (result.citations.length > 0) {
    block.Citations = result.citations;
  }
}

// Then process footnotes (existing code)
if (IN_PAGE_FOOTNOTES_ENABLED) {
  // footnote extraction...
}
```

Order matters because:
1. Footnote content (child blocks) might have `[@citation]` markers
2. Those child blocks are processed by `_buildBlock()` too
3. Their citations get extracted first, replacing `[@key]` with markers
4. Then their text becomes part of footnote content

#### 4. Add to `getPostContentByPostId()`

After footnotes cache handling:
```typescript
let citationsInPage = null;
if (CITATIONS_ENABLED) {
  // Try load from cache
  if (shouldUseCache && fs.existsSync(cachePath)) {
    citationsInPage = JSON.parse(...);
  } else {
    // Extract and prepare
    citationsInPage = extractCitationsInPage(blocks, BIBLIOGRAPHY_STYLE);
    citationsInPage = prepareBibliography(citationsInPage, BIBLIOGRAPHY_STYLE);
    // Save cache
    fs.writeFileSync(cachePath, JSON.stringify(citationsInPage));
  }
}

return { blocks, interlinkedContentInPage, footnotesInPage, citationsInPage };
```

---

## Phase 4: Components

### 1. CitationMarker Component

**New File**: `src/components/notion-blocks/CitationMarker.astro`

Purpose: Render in-text citation markers

Props: `{ richText, blockID, citation, block }`

What it does:
- Find citation from `block.Citations` using `richText.CitationRef`
- Display text: IEEE shows `[1]`, APA shows `[Author, Year]`
- Add `data-margin-note` and `data-popover-target` attributes
- Create template with formatted entry for popup/margin

Example output: `<sup>[1]</sup>` or `<sup>[Smith et al., 2020]</sup>`

### 2. BibliographySection Component

**New File**: `src/components/blog/BibliographySection.astro`

Purpose: Render bibliography at end of page

Props: `{ citations }`

Important imports:
```typescript
import { getSymbolForLinkedContent } from "@/utils";  // For backlinks
```

What it renders:
```
Bibliography
1. Formatted entry at [‡][§][Δ]
2. Another entry at [‡]
```

Key implementation:
- Use `<ol style="list-style-type: decimal">` for BOTH styles (IEEE and APA)
- For each citation, render formatted entry
- Then render backlinks: `citation.SourceBlockIds.map((blockId, index) => ...)`
- Each backlink: `<a href={`#${blockId}`}>[{getSymbolForLinkedContent(index)}]</a>`
- Add "at" text before backlinks for readability

### 3. CiteThisPage Component

**New File**: `src/components/blog/CiteThisPage.astro`

Purpose: Generate BibTeX entry for current page

Props: `{ post }`

What it does:
- Create BibTeX entry with post slug as key
- Extract year from post.Date
- Include author, title, URL, access date
- Render in `<pre>` with copy button

---

## Phase 5: Integration

### File: `src/components/notion-blocks/RichText.astro`

Add after footnote marker check:
```astro
{richText.IsCitationMarker && richText.CitationRef && (
  <CitationMarker richText={richText} blockID={blockID} block={block} />
)}
```

### File: `src/pages/posts/[slug].astro`

Import components, get citations from `getPostContentByPostId()`, render in this order:

**IMPORTANT SECTION ORDER**:
1. Main content (NotionBlocks)
2. Footnotes section (if enabled)
3. **Bibliography section** (if enabled) ← NEW
4. **"Cite This Page" section** (if enabled) ← NEW
5. Interlinked content section (existing)

```astro
{/* After main content */}

{/* 2. Footnotes */}
{adjustedFootnotesConfig?.["generate-footnotes-section"] && footnotesInPage && (
  <FootnotesSection footnotes={footnotesInPage} />
)}

{/* 3. Bibliography */}
{CITATIONS?.["extract-and-process-bibtex-citations"]?.["generate-bibliography-section"] && citationsInPage && (
  <BibliographySection citations={citationsInPage} />
)}

{/* 4. Cite This Page */}
{CITATIONS?.["add-cite-this-post-section"] && (
  <CiteThisPage post={post} />
)}

{/* 5. Interlinked Content (existing) */}
{INTERLINKED_CONTENT && (
  <InterlinkedContentSection ... />
)}
```

Repeat for `[...page].astro` and `PostPreviewFull.astro`.

---

## Phase 6: Dependencies

Install:
```bash
npm install @citation-js/core @citation-js/plugin-bibtex @citation-js/plugin-csl
```

These provide:
- BibTeX parsing
- CSL formatting for APA/IEEE
- Author name handling

**Important**: Use modular imports to keep bundle size small (tree-shakeable):
```typescript
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-bibtex';  // Only register BibTeX plugin
import '@citation-js/plugin-csl';     // Only register CSL plugin
// Don't import entire library - only what we need
```

---

## Phase 7: Margin Notes

**No changes needed!** The existing `margin-notes.ts` uses `[data-margin-note]` selector, which CitationMarker adds automatically. Citations will stack with footnotes using existing overlap prevention.

### Special Case: Citations in Footnote Content

When a citation appears inside a footnote's content that is displayed in the margin:
1. The citation marker in the footnote content gets `data-margin-note` attribute
2. The margin-notes.ts script will position it automatically
3. It will appear **below** the footnote content in the margin (natural stacking order)
4. The backlink in the bibliography will link to the **footnote marker's block**, not directly to the citation in the footnote content

This works automatically because:
- Footnote content is displayed in margin at the footnote marker's vertical position
- Citation within that content gets positioned relative to its container
- Existing overlap prevention ensures proper spacing

---

## Implementation Order

1. **Phase 1** (15 min) - Types and constants
2. **Phase 9** (5 min) - Install npm packages
3. **Phase 2** (45 min) - Create `citations.ts` with all functions
4. **Phase 3** (30 min) - Integrate into `client.ts`
5. **Phase 4** (40 min) - Create 3 components
6. **Phase 5** (20 min) - Update RichText and page files
7. **Test** (30 min) - Verify with real BibTeX file

---

## Key Gotchas

### 1. Process Citations BEFORE Footnotes in `_buildBlock()`

**CRITICAL ORDER**:
```typescript
// ✓ CORRECT ORDER
1. Extract citations from block (replace [@key] markers)
2. Extract footnotes from block

// ❌ WRONG ORDER
1. Extract footnotes first
2. Extract citations  // Too late! Footnote content already captured
```

Why: Footnote content blocks can contain `[@citation]` markers. Those child blocks get processed by `_buildBlock()` too, and their citations must be extracted first (so the citation markers are replaced before the text becomes footnote content).

### 2. Don't Traverse Blocks Again
```typescript
// WRONG
function traverse(blocks) {
  for (const block of blocks) {
    const children = getChildren(block);
    traverse(children);  // ❌ No!
  }
}

// CORRECT
blocks.forEach(block => {
  if (block.Citations) { ... }  // ✓ Just iterate
});
```

### 3. Citations Inside Footnotes
Don't forget footnote content blocks can have citations:
```typescript
if (block.Footnotes) {
  block.Footnotes.forEach(footnote => {
    if (footnote.Content.Type === "blocks") {
      footnote.Content.Blocks.forEach(fnBlock => {
        if (fnBlock.Citations) { /* process */ }
      });
    }
  });
}
```

### 4. Array, Not String
```typescript
// WRONG
interface Citation {
  SourceBlockId: string;  // ❌
}

// CORRECT
interface Citation {
  SourceBlockIds: string[];  // ✓
}
```

### 5. Symbol Backlinks, Not Arrow
```astro
<!-- WRONG (like footnotes) -->
<a href={`#${blockId}`}>↩</a>

<!-- CORRECT (multiple symbols) -->
{citation.SourceBlockIds.map((blockId, index) => (
  <a href={`#${blockId}`}>[{getSymbolForLinkedContent(index)}]</a>
))}
```

### 6. Numbers, Not Alphabets
```
WRONG (footnotes style):
a. First entry
b. Second entry

CORRECT (citations style):
1. First entry
2. Second entry
```

---

## Testing Checklist

- [ ] BibTeX file fetched from GitHub and cached
- [ ] `[@key]` markers detected and replaced
- [ ] In-text shows `[1]` (IEEE) or `[Author, Year]` (APA)
- [ ] Bibliography renders with numbers (1, 2, 3...)
- [ ] IEEE: Bibliography sorted by first occurrence order
- [ ] APA: Bibliography sorted alphabetically by author
- [ ] Multiple backlinks show symbols: [‡][§][Δ]
- [ ] Clicking each symbol jumps to correct occurrence
- [ ] Margin notes work on large screens
- [ ] Popups work on small screens
- [ ] **CRITICAL**: Citation in footnote content works correctly (displays as citation marker, not raw `[@key]`)

---

## Files Summary

**New (5):**
1. `src/lib/citations.ts` - All citation logic
2. `src/components/notion-blocks/CitationMarker.astro` - In-text markers
3. `src/components/blog/BibliographySection.astro` - Bibliography rendering
4. `src/components/blog/CiteThisPage.astro` - BibTeX generator
5. Cache directories (auto-created)

**Modified (8):**
1. `src/lib/interfaces.ts` - Add Citation types
2. `src/constants.ts` - Add CITATIONS exports
3. `src/lib/notion/client.ts` - Add BibTeX init and citation processing
4. `src/components/notion-blocks/RichText.astro` - Handle citation markers
5. `src/pages/posts/[slug].astro` - Render bibliography
6. `src/pages/[...page].astro` - Render bibliography
7. `src/components/blog/PostPreviewFull.astro` - Render bibliography
8. `package.json` - Add dependencies

---

## Success Criteria

**Must Have:**
- BibTeX files fetched and parsed correctly
- Citations extracted from all text locations
- Bibliography rendered with correct sorting (IEEE: appearance, APA: alphabetical)
- Multiple backlinks using symbols work
- No build errors

**Should Have:**
- GitHub timestamp checking works (cache invalidation)
- Margin notes display without overlapping footnotes
- Author capping at 8 with "et al."

---

## Comparison: Footnotes vs Citations

| Feature | Footnotes | Citations |
|---------|-----------|-----------|
| Marker uniqueness | Each unique (`[^ft_a]`) | Keys repeat (`[@smith2020]`) |
| Bibliography numbering | Alphabetical (a, b, c) | Numerical (1, 2, 3) |
| Bibliography sorting | Alphabetical by marker | **IEEE**: By first occurrence<br>**APA**: Alphabetical by author |
| Backlinks per entry | Single `↩` | Multiple `[‡][§][Δ]` |
| Data structure | `SourceBlockId: string` | `SourceBlockIds: string[]` |
| Collection method | Traverse once during build | Collect from pre-processed arrays |
| Similar system | Unique | Interlinked content |

---

## Coverage Checklist vs Desired Implementation

Comparing against `.agents/feature_initial_docs.md/citations_implementation_desired.md`:

### Core Features ✅
- [x] "Cite This Page" section with BibTeX entry generation
- [x] Section order: Main → Footnotes → Bibliography → Cite This Page → Interlinked Content
- [x] BibTeX file sources: GitHub Gist, GitHub Repo, Dropbox, Google Drive
- [x] Multiple .bib file URLs supported
- [x] URL normalization with exact examples provided
- [x] Timestamp checking for GitHub (Gist and Repo)
- [x] No timestamp for Dropbox/Drive (refetch every build or use cache based on LAST_BUILD_TIME)

### In-Text Citations ✅
- [x] Three formats: `[@key]`, `\cite{key}`, `#cite(key)`
- [x] IEEE: Display as `[1][2]` (numbered by first occurrence)
- [x] APA: Display as `[Author et al., Year]`
- [x] Popover with formatted entry on hover/click
- [x] Margin display on large screens (small-popup-large-margin mode)
- [x] Always-popup mode supported

### Bibliography ✅
- [x] Auto-generated at end of page (after footnotes, before interlinked content)
- [x] APA: Sorted alphabetically by author
- [x] IEEE: Sorted by order of first occurrence
- [x] Only includes citations used on current page
- [x] Max 8 authors then "et al."
- [x] Backlinks using symbols `[‡][§][Δ]` (like interlinked content)
- [x] Each backlink jumps to block where citation appears
- [x] Hover/click backlink shows original block context

### Processing ✅
- [x] Build-time extraction (not runtime)
- [x] Cached in JSON format (per-page + BibTeX files)
- [x] Uses LAST_BUILD_TIME for cache invalidation
- [x] Tree-shakeable library usage (modular citation-js imports)
- [x] Citations extracted BEFORE footnotes (critical order)
- [x] Citations in footnote content properly handled

### Display Integration ✅
- [x] Three locations: `posts/[slug].astro`, `[...page].astro`, `PostPreviewFull.astro`
- [x] Margin notes work without overlapping footnotes
- [x] Citations in footnote content appear below footnote in margin
- [x] Backlinks from bibliography link to footnote marker block (not citation inside footnote)

### Configuration ✅
- [x] `add-cite-this-post-section` toggle
- [x] `extract-and-process-bibtex-citations.enabled` toggle
- [x] `bibtex-file-url-list` array
- [x] `in-text-citation-format` selector
- [x] `bibliography-format` selector (one at a time)
- [x] `generate-bibliography-section` toggle
- [x] `intext-display` options (always-popup, small-popup-large-margin)

### Technical Details ✅
- [x] Store processed entries in JSON with key mapping
- [x] Store downloaded .bib files with metadata (url, last_updated, entry_count)
- [x] Cache in `tmp/` directory
- [x] Group citations by key (handle repeated keys)
- [x] Assign index on first occurrence
- [x] Components have zero logic (render pre-processed data)

### Everything Discussed ✅
- [x] Numbers (1, 2, 3) not alphabets (a, b, c) for bibliography
- [x] SourceBlockIds is array, not single string
- [x] Multiple symbol backlinks, not single arrow
- [x] IEEE sorted by first occurrence order
- [x] Don't traverse blocks again (collect from pre-processed arrays)
- [x] Citations in footnotes must be processed first

---

That's it! Follow the phases in order, remember the key differences from footnotes, and you'll have working citations.
