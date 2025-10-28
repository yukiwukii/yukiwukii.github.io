# Citations Feature Implementation Plan (Revised v2)

This document outlines the plan to implement the citations feature based on the revised requirements in `@.agents/feature_initial_docs.md/citations_implementation_desired.md`.

## 1. Configuration

- **File:** `constants-config.json5`
- **Action:** Update the `citations` object, specifically the `bibliography-format` to be ` { "simplified-ieee": true, "apa": false }`.
- **File:** `src/constants.ts` & `src/site.config.ts`
- **Action:** Update types and configuration loading to select the single active bibliography style (e.g., `simplified-ieee` or `apa`).

## 2. BibTeX Data Fetching and Processing

- **New File:** `src/lib/citations.ts`
- **Action:**
    - Create `get_bib_source_info()` to resolve download URLs for BibTeX files.
    - Implement fetching and parsing of `.bib` files using the modular `citation-js` library.
    - Implement a caching system in the `tmp/` directory for the parsed BibTeX data.

## 3. Page-Level Citation Analysis

- **Files to Modify:** `src/pages/posts/[slug].astro`, `src/pages/[...page].astro`
- **Action:** Before rendering the main content, a new script will perform a pre-pass on the Notion blocks to:
    1.  Extract all citation keys (e.g., `mykey1` from `[@mykey1]`).
    2.  Create an ordered list of these keys based on their **first appearance** in the document. This list is crucial for generating the correct numbers for IEEE-style citations.
    3.  This ordered list of keys will be passed down to the rendering components.

## 4. In-Text Citation and Margin Note Implementation

- **New File:** `src/components/notion-blocks/CitationMarker.astro`
- **Action:** This component will now require the active `bibliography-style` and the ordered list of keys as props.
    - **If style is `simplified-ieee`:** It will find the key in the ordered list to get its number (e.g., `[1]`, `[2]`) and render that.
    - **If style is `apa`:** It will use `citation-js` to render the format `[Author et al., Year]`.
    - The component will still handle the `intext-display` logic (margin notes vs. popups) as previously planned, using a refactored `src/assets/scripts/margin-notes.ts` to prevent overlaps.

- **File to Modify:** `src/components/notion-blocks/RichText.astro`
- **Action:** Will continue to be responsible for finding citation shortcodes and rendering the `<CitationMarker />` component, passing the necessary props.

## 5. Bibliography Generation

- **New File:** `src/components/blog/Bibliography.astro`
- **Action:** This component will also require the active `bibliography-style` and the ordered list of keys.
    - **Sorting:**
        - **If `simplified-ieee`:** It will render the bibliography sorted by the **order of appearance** (using the passed-in ordered list).
        - **If `apa`:** It will render the bibliography sorted **alphabetically** by author.
    - **Formatting:**
        - It will use `citation-js` to format the final entries.
        - **Author Cap:** We will configure the CSL engine to cap author lists at a maximum of 8 before using "et al.".
    - **Backlinks:** The previously planned backlink implementation (linking from the bibliography entry back to the in-text markers) remains the same.

## 6. "Cite This Page" Section

- **No change:** This component remains as planned.

## 7. Dependencies

- **File:** `package.json`
- **Action:** Add the necessary modular `citation-js` packages.
- **Packages to install:**
    - `@citation-js/core`
    - `@citation-js/plugin-bibtex`
    - `@citation-js/plugin-csl`: To handle formatting output styles (e.g., Simplified IEEE, APA). We will only register the specific styles needed.