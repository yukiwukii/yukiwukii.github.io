# Citations Feature Implementation Plan (Revised)

This document outlines the plan to implement the citations feature based on the revised requirements in `@.agents/feature_initial_docs.md/citations_implementation_desired.md`.

## 1. Configuration

- **File:** `constants-config.json5`
- **Action:** Update the `citations` object to match the new structure, including `generate-bibliography-section` and the `intext-display` options. The `bibliography-format` will be an object like `{"apa": true, "mla": false, ...}`.
- **File:** `src/constants.ts` & `src/site.config.ts`
- **Action:** Update types and configuration loading to reflect the new structure. The site configuration will determine the single active bibliography style.

## 2. BibTeX Data Fetching and Processing

- **New File:** `src/lib/citations.ts`
- **Action:**
    - Create `get_bib_source_info()` to resolve download URLs for BibTeX files from various sources (GitHub, Dropbox, etc.).
    - Implement fetching and parsing of `.bib` files using the `citation-js` library. This will be a new dependency.
    - Implement a caching system in the `tmp/` directory for the parsed BibTeX data (as JSON). The cache will be keyed by URL and will be invalidated using last-modified timestamps for GitHub sources, or on every build for others.
    - During page rendering, all citation keys used will be collected and stored.

## 3. In-Text Citation and Margin Note Implementation

This is the most significant change. The implementation will depend on the `intext-display` setting.

- **New File:** `src/components/notion-blocks/CitationMarker.astro`
- **Action:** This component will be responsible for rendering in-text citations. It will accept the citation key, the target bibliography entry ID, and the surrounding block's ID as props.

- **File to Modify:** `src/components/notion-blocks/RichText.astro`
- **Action:**
    - Scan for citation shortcodes (e.g., `#cite({key})`).
    - For each match, instead of directly inserting an `<a>` tag, it will render the new `<CitationMarker />` component.

- **File to Modify:** `src/assets/scripts/margin-notes.ts`
- **Action:**
    - This script will be refactored to manage a general pool of margin items (both footnotes and citations).
    - It will calculate the vertical position of each marker and dynamically place the corresponding margin note content to avoid overlaps. Each note (footnote or citation) will be positioned sequentially based on its marker's appearance in the document flow.

- **Conditional Rendering Logic (`CitationMarker.astro`):**
    - **If `small-popup-large-margin` is true:**
        - On large screens, it will render a marker and create a `<div>` with the formatted citation content that `margin-notes.ts` will pick up and place in the margin.
        - On small screens (handled via CSS media queries), the margin content will be hidden, and the marker will fall back to being a clickable element that triggers a popover.
    - **If `always-popup` is true:**
        - It will render a simple `<a>` tag that triggers the existing popover script (`popover.ts`), regardless of screen size.

- **Citations in Footnotes:**
    - The `RichText.astro` component is used to render footnote content. The existing logic will naturally handle citations within footnotes, creating nested markers.
    - The refactored `margin-notes.ts` will handle positioning. When a citation appears in a footnote that is itself in the margin, the citation's formatted entry will be appended directly below the footnote content within the same margin note container.

## 4. Bibliography Generation

- **New File:** `src/components/blog/Bibliography.astro`
- **Action:**
    - This component will be rendered if `generate-bibliography-section` is true.
    - It will receive the list of unique citation keys used on the page.
    - It will use `citation-js` to format a bibliography in the configured style (APA, MLA, or Chicago).
    - **Backlinks:** For each entry in the bibliography, it will include a list of markers (e.g., `[1]`, `[2]`) that link back to the specific `CitationMarker` instances in the text. This provides a way to navigate from the bibliography back to the context of the citation.

## 5. "Cite This Page" Section

- **New File:** `src/components/blog/CiteThisPage.astro`
- **Action:**
    - This component remains as planned. It will generate a BibTeX entry for the current page based on its metadata and display it in a code block.

## 6. Integration

- **Files to modify:** `src/pages/posts/[slug].astro`, `src/pages/[...page].astro`, `src/components/blog/PostPreviewFull.astro`
- **Action:**
    - The logic within these files will be updated to:
        1. Scan the rendered HTML to collect all used citation keys and their corresponding block IDs.
        2. If `generate-bibliography-section` is true, render the `<Bibliography />` component at the end of the post content, passing the collected keys and block data.
        3. If `add-cite-this-post-section` is true, render the `<CiteThisPage />` component.

## 7. Dependencies

- **File:** `package.json`
- **Action:** Add the necessary `citation-js` packages. To keep the final bundle size to a minimum, we will use its modular, plugin-based architecture instead of importing the entire library.
- **Packages to install:**
    - `@citation-js/core`: The lightweight central engine.
    - `@citation-js/plugin-bibtex`: To parse `.bib` format files.
    - `@citation-js/plugin-csl`: To handle formatting output styles (APA, MLA, Chicago). We will only register the specific styles needed.