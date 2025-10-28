# Fix Citation & Footnote Mobile Non-Interactive Popover Issue Using NBlocksPopover

**Date**: 2025-10-27
**Status**: PLAN - Not yet implemented

---

## Problem Statement

On mobile (<640px), footnote and citation popovers display correctly but are completely non-interactive:
- ❌ Cannot click links inside them
- ❌ Cannot select/highlight text
- ❌ Cannot click "Jump to bibliography" button
- ❌ Clicking anywhere inside closes the popover immediately

**Debug findings**: Clicks pass through the popover and hit `div.post-body` (main content area) behind it.

**Working popovers**: NPage and NBlock popovers work perfectly on mobile with identical:
- Structure
- Classes
- Z-index
- Positioning (Floating UI)
- Empty `<span data-popover-link></span>` element

**The mystery**: We cannot identify what makes NBlock/NPage popovers work while footnote/citation popovers fail, despite exhaustive debugging.

---

## Solution Approach

**Use the exact same component that works**: Instead of trying to figure out the subtle difference, make footnotes and citations use `NBlocksPopover.astro` - the component we KNOW works on mobile.

### Why This Will Work

1. **Eliminates all potential differences**: Uses identical rendering logic
2. **Proven to work on mobile**: NBlock popovers already tested and working
3. **Minimal changes**: Adapt data to fit NBlocksPopover's interface
4. **Keeps existing features**: Margin notes, styling, all current functionality preserved

---

## Current NBlocksPopover Component Analysis

### Location
`src/components/blog/interlinked-content/NBlocksPopover.astro`

### Props Interface (WILL BE EXTENDED)
```typescript
interface Props {
    block: Block;                 // Notion block to render
    linkedTo: string;             // URL for navigation
    popoverSpanText: string;      // Text shown in trigger span
    popoverTitle?: string;        // Title in popover (optional)
    linkText?: string;            // "Read more" text (default: "Read more")
    isInterlinkedBack?: boolean;  // Styling flag for underlines

    // NEW FLAGS TO ADD:
    isInPageFootnote?: boolean;      // In-page footnote (not global footnotes page)
    isInPageCitation?: boolean;      // In-page citation
    citationActionOnClick?: string;  // onclick handler for citation action link
                                     // (will reuse linkText and linkedTo for the link itself)
}
```

### Current Modes (Will Be Expanded to Four)

**IMPORTANT DISTINCTION**: The existing `isFootnote` mode is for **GLOBAL footnotes** (sitewide footnotes page), NOT in-page footnotes. We need separate modes for in-page content.

**1. GLOBAL Footnote Mode** (existing `isFootnote` - automatically detected):
- Triggers when `linkedTo` contains `/posts/{SITEWIDE_FOOTNOTES_PAGE_SLUG}`
- Renders: `<NotionBlocks blocks={[block]} renderChildren={false} />`
- Adds: Empty `<span data-popover-link></span>` at end
- NO "Read more" link
- NO outer `<a>` wrapper
- **This is the mode that works on mobile!**

**2. IN-PAGE Footnote Mode** (NEW - `isInPageFootnote=true`):
- Similar to global footnote mode
- **Key difference**: Renders with `renderChildren={true}` (allows nested content like block links)
- Adds: Empty `<span data-popover-link></span>` at end
- NO "Read more" link
- NO outer `<a>` wrapper

**3. IN-PAGE Citation Mode** (NEW - `isInPageCitation=true`):
- Renders: `<NotionBlocks blocks={[block]} renderChildren={false} />`
- Adds: Action link using `linkText`, `linkedTo`, and `citationActionOnClick`
- Example: "Jump to bibliography" button with custom onclick handler
- NO outer `<a>` wrapper

**4. Regular Interlinked Page Mode** (default):
- Wraps content in `<a href={linkedTo}>`
- Shows title, block content, and "Read more" link
- Used for interlinked pages

### Key Detection Logic (lines 22-26)
```typescript
let isFootnote = false;
const footnotePattern = "posts/" + SITEWIDE_FOOTNOTES_PAGE_SLUG;
if (linkedTo && (linkedTo.includes(footnotePattern + "/") || linkedTo.endsWith(footnotePattern))) {
    isFootnote = true;
}
```

---

## Implementation Plan

### Phase 1: Footnotes Use NBlocksPopover

#### Current Footnote Types in FootnoteMarker.astro

**Type 1: "rich_text"** - Inline text footnotes
```typescript
footnote.Content.Type === "rich_text"
footnote.Content.RichTexts: RichText[]
```

**Type 2: "blocks"** - Block-based footnotes
```typescript
footnote.Content.Type === "blocks"
footnote.Content.Blocks: Block[]
```

**Type 3: "comment"** - Comment-based with attachments
```typescript
footnote.Content.Type === "comment"
footnote.Content.RichTexts: RichText[]
footnote.Content.CommentAttachments?: Attachment[]
```

#### Strategy: Create Faux Blocks

Convert all footnote types to `Block[]` that NBlocksPopover expects.

##### For Type "blocks" (Already Perfect)
```typescript
// Pass directly - already Block[]
const blocksToRender = footnote.Content.Blocks;
```

##### For Type "rich_text" (Create Faux Paragraph)
```typescript
const fauxBlock: Block = {
    Id: `${block.Id}-footnote-${footnote.Id}`,
    Type: "paragraph",
    HasChildren: false,
    Paragraph: {
        RichTexts: footnote.Content.RichTexts,
        Color: "default"
    },
    // Other required Block properties with defaults
    Parent: { Type: "page_id", PageId: "" },
    Object: "block",
    CreatedTime: "",
    LastEditedTime: "",
    Archived: false,
    InTrash: false,
    HasBlockChildren: false
};
const blocksToRender = [fauxBlock];
```

##### For Type "comment" (Create Paragraph + Attachment Blocks)
```typescript
const blocks: Block[] = [];

// Add paragraph block for text content
blocks.push({
    Id: `${block.Id}-comment-text`,
    Type: "paragraph",
    HasChildren: false,
    Paragraph: {
        RichTexts: footnote.Content.RichTexts,
        Color: "default"
    },
    // ... other required fields
});

// Add blocks for each attachment
if (footnote.Content.CommentAttachments?.length > 0) {
    footnote.Content.CommentAttachments.forEach((attachment, i) => {
        const attachmentType =
            attachment.Category === "image" ? "image" :
            attachment.Category === "video" ? "video" :
            attachment.Category === "audio" ? "audio" :
            attachment.Category === "pdf" ? "pdf" : "file";

        blocks.push({
            Id: `${block.Id}-comment-attachment-${i}`,
            Type: attachmentType,
            HasChildren: false,
            [attachmentType === "image" ? "Image" : "File"]: {
                Type: "external",
                Url: attachment.Url,
                ExpiryTime: ""
            },
            // ... other required fields
        });
    });
}
const blocksToRender = blocks;
```

#### Changes to FootnoteMarker.astro

**1. Import NBlocksPopover**
```astro
import NBlocksPopover from "@/components/blog/interlinked-content/NBlocksPopover.astro";
```

**2. Create Helper Function to Convert Footnote to Blocks**
```typescript
function footnoteToBlocks(footnote: Footnote, baseId: string): Block[] {
    if (footnote.Content.Type === "blocks") {
        return footnote.Content.Blocks || [];
    }

    if (footnote.Content.Type === "rich_text") {
        return [{
            Id: `${baseId}-rt`,
            Type: "paragraph",
            HasChildren: false,
            Paragraph: {
                RichTexts: footnote.Content.RichTexts || [],
                Color: "default"
            },
            // ... minimal required Block fields
        }];
    }

    if (footnote.Content.Type === "comment") {
        const blocks = [];

        // Text content
        if (footnote.Content.RichTexts?.length > 0) {
            blocks.push({
                Id: `${baseId}-ct`,
                Type: "paragraph",
                Paragraph: {
                    RichTexts: footnote.Content.RichTexts,
                    Color: "default"
                },
                // ... minimal fields
            });
        }

        // Attachments
        footnote.Content.CommentAttachments?.forEach((att, i) => {
            const type = att.Category === "image" ? "image" : "file";
            blocks.push({
                Id: `${baseId}-att-${i}`,
                Type: type,
                [type === "image" ? "Image" : "File"]: {
                    Type: "external",
                    Url: att.Url
                },
                // ... minimal fields
            });
        });

        return blocks;
    }

    return [];
}
```

**3. Replace Template with NBlocksPopover Component**

**BEFORE** (lines 102-147):
```astro
<template id={`template-popover-${uniqueId}`}>
    <div data-popover ...>
        {/* Complex conditional rendering */}
    </div>
</template>
```

**AFTER**:
```astro
{!isMarginMode && (
    <NBlocksPopover
        block={footnoteToBlocks(footnote, block.Id)[0]}
        linkedTo={`/posts/${SITEWIDE_FOOTNOTES_PAGE_SLUG}/#${uniqueId}`}
        popoverSpanText=""
    />
)}
```

**4. Keep Margin Notes Template**
```astro
{isMarginMode && (
    <template id={`template-margin-${uniqueId}`}>
        {/* Existing margin notes template - unchanged */}
    </template>
)}
```

**Note**: The `linkedTo` URL intentionally includes the footnotes page slug pattern so NBlocksPopover auto-detects `isFootnote` mode.

---

### Phase 2: Citations Use NBlocksPopover

#### Current Citation Structure

```typescript
citation: Citation = {
    Key: string;
    Authors: string;
    Year: number;
    FormattedEntry: string;  // HTML string
    Index?: number;
    SourceBlockIds: string[];
}
```

#### Strategy: Create Faux Paragraph with Citation Content

**Option A: Use FormattedEntry HTML directly**
```typescript
const fauxBlock: Block = {
    Id: `citation-${citation.Key}`,
    Type: "paragraph",
    Paragraph: {
        RichTexts: [{
            Type: "text",
            PlainText: citation.FormattedEntry.replace(/<[^>]*>/g, ''), // Strip HTML
            Text: {
                Content: citation.FormattedEntry.replace(/<[^>]*>/g, ''),
                Link: null
            },
            Annotations: {
                Bold: false,
                Italic: false,
                Strikethrough: false,
                Underline: false,
                Code: false,
                Color: "default"
            }
        }],
        Color: "default"
    }
};
```

**Option B: Parse HTML to RichText array** (better for preserving formatting)
```typescript
// Parse citation.FormattedEntry HTML and convert to RichText[]
// This preserves italics, bold, etc. from the formatted citation
```

#### Add "Jump to Bibliography" Link for Citations

**Problem**: Citations need an action link (e.g., "Jump to bibliography") with custom onclick behavior.

**Solution**: Reuse existing props and add only onclick handler.

**Reuse existing props**:
- `linkText` - The text for the action link (e.g., "Jump to bibliography")
- `linkedTo` - The href for the action link (e.g., `#citation-def-${citation.Key}`)
- `citationActionOnClick` (NEW) - The onclick handler string

**Update NBlocksPopover template** (inside `isInPageCitation` mode):
```astro
{isInPageCitation ? (
    <div class="space-y-2 p-3">
        <NotionBlocks blocks={[block]} renderChildren={false} setId={false} />
        {linkText && linkedTo && (
            <div class="border-t border-accent-2/20 pt-2 mt-2">
                <a
                    href={linkedTo}
                    data-popover-link
                    class="text-quote hover:text-quote/80 text-xs flex items-center gap-1 transition-colors"
                    onclick={citationActionOnClick}
                >
                    <span>{linkText}</span>
                    <span aria-hidden="true">↓</span>
                </a>
            </div>
        )}
        <span data-popover-link>{""}</span>
    </div>
) : (
    // ... regular mode
)}
```

#### Changes to CitationMarker.astro

**1. Import NBlocksPopover**
```astro
import NBlocksPopover from "@/components/blog/interlinked-content/NBlocksPopover.astro";
```

**2. Create Helper Function**
```typescript
function citationToBlock(citation: Citation): Block {
    // Strip HTML tags for plain text, or better: parse to RichText
    const plainText = citation.FormattedEntry.replace(/<[^>]*>/g, '');

    return {
        Id: `citation-${citation.Key}`,
        Type: "paragraph",
        Paragraph: {
            RichTexts: [{
                Type: "text",
                PlainText: plainText,
                Text: { Content: plainText, Link: null },
                Annotations: {
                    Bold: false,
                    Italic: false,
                    Strikethrough: false,
                    Underline: false,
                    Code: false,
                    Color: "default"
                }
            }],
            Color: "default"
        },
        // ... minimal required fields
    };
}
```

**3. Replace Template with NBlocksPopover**

**BEFORE** (lines 74-119):
```astro
<template id={`template-popover-${uniqueId}`}>
    <div data-popover ...>
        {/* Citation content */}
    </div>
</template>
```

**AFTER**:
```astro
<NBlocksPopover
    block={citationToBlock(citation)}
    popoverSpanText=""
    isInPageCitation={true}
    linkText={showBibliography ? "Jump to bibliography" : undefined}
    linkedTo={showBibliography ? `#citation-def-${citation.Key}` : undefined}
    citationActionOnClick={showBibliography ? `
        event.preventDefault();
        document.querySelectorAll('li[data-show-back-button]').forEach(li => {
            delete li.dataset.showBackButton;
            delete li.dataset.backToBlock;
        });
        const target = document.getElementById('citation-def-${citation.Key}');
        if (target) {
            target.dataset.showBackButton = 'true';
            target.dataset.backToBlock = '${blockID}';
        }
        window.location.hash = '#citation-def-${citation.Key}';
        target?.scrollIntoView({ behavior: 'smooth' });
    ` : undefined}
/>
```

---

## Implementation Steps

### Step 1: Extend NBlocksPopover Component
- Add three new optional props: `isInPageFootnote`, `isInPageCitation`, `citationActionOnClick`
- Update rendering logic to handle 4 modes:
  1. Global footnote (existing `isFootnote` auto-detection) - `renderChildren={false}`
  2. In-page footnote (`isInPageFootnote=true`) - `renderChildren={true}`
  3. In-page citation (`isInPageCitation=true`) - with action link using `linkText`/`linkedTo`/`citationActionOnClick`
  4. Regular interlinked page (default)
- Test that existing NBlock/NPage popovers still work (no regression)

### Step 2: Update FootnoteMarker.astro
- Import NBlocksPopover
- Add `footnoteToBlocks()` helper function to convert all 3 footnote types to Block[]
- Replace popover template with NBlocksPopover component (pass `isInPageFootnote=true`)
- Keep margin notes template unchanged (for desktop)
- Test all three footnote types on mobile (<640px)

### Step 3: Update CitationMarker.astro
- Import NBlocksPopover
- Add `citationToBlock()` helper function to convert Citation to Block
- Replace popover template with NBlocksPopover component
- Pass `isInPageCitation=true`, `linkText`, `linkedTo`, and `citationActionOnClick` for bibliography link
- Test citations on mobile (<640px)

### Step 4: Testing
- ✅ Test footnotes (rich_text type) on mobile
- ✅ Test footnotes (blocks type) on mobile
- ✅ Test footnotes (comment type) on mobile
- ✅ Test citations on mobile
- ✅ Test "Jump to bibliography" link works
- ✅ Test margin notes still work on desktop
- ✅ Test NBlock popovers still work (no regression)
- ✅ Test NPage popovers still work (no regression)

### Step 5: Cleanup
- Remove debug console.log statements from popover.ts
- Update documentation in mobile-interaction-fix.md
- Document the approach in implementation-notes.md

---

## Benefits of This Approach

1. **Guaranteed to work**: Uses proven working component
2. **No more debugging mystery**: Eliminates unknown differences
3. **Maintainability**: Single popover rendering logic
4. **Type safety**: Converts everything to strongly-typed Block interface
5. **Feature preservation**: Keeps all existing functionality (margin notes, etc.)
6. **Future proof**: Any fixes to NBlocksPopover benefit all popovers

---

## Potential Issues & Solutions

### Issue 1: Multiple blocks for single footnote
**Problem**: NBlocksPopover expects `block: Block` (singular), but comment footnotes create multiple blocks.

**Solution**:
- Option A: Wrap multiple blocks in a single parent block
- Option B: Extend NBlocksPopover to accept `blocks: Block[]` (better)

### Issue 2: Citation HTML formatting lost
**Problem**: Converting `FormattedEntry` HTML to plain text loses italics, bold, etc.

**Solution**: Write HTML-to-RichText parser to preserve formatting:
```typescript
function parseHTMLToRichText(html: string): RichText[] {
    // Parse <i>, <b>, <em>, <strong> tags
    // Convert to RichText with appropriate Annotations
}
```

### Issue 3: Margin notes positioning
**Problem**: Margin notes need different rendering than mobile popovers.

**Solution**: Keep separate template for margin mode (already planned).

---

## Files to Modify

1. **`src/components/blog/interlinked-content/NBlocksPopover.astro`**
   - Add `actionLink` prop
   - Add action link rendering in `isFootnote` mode

2. **`src/components/notion-blocks/FootnoteMarker.astro`**
   - Import NBlocksPopover
   - Add helper functions
   - Replace popover template with component

3. **`src/components/notion-blocks/CitationMarker.astro`**
   - Import NBlocksPopover
   - Add helper functions
   - Replace popover template with component

4. **`.agents/claude/citations/mobile-interaction-fix.md`**
   - Document this approach as Attempt 5
   - Mark as WORKING once tested

5. **`.agents/claude/citations/implementation-notes.md`**
   - Add section about mobile fix using NBlocksPopover

---

## Rollback Plan

If this approach fails:
1. Git revert changes
2. Original templates still exist in git history
3. No data structure changes - only rendering changes

---

## Success Criteria

✅ Citations work on mobile (<640px)
✅ Footnotes (all 3 types) work on mobile
✅ "Jump to bibliography" works
✅ Margin notes still work on desktop
✅ No regression in NBlock/NPage popovers
✅ Code is cleaner and more maintainable

---

**Status**: Ready for implementation
**Next**: Implement Step 1 (Extend NBlocksPopover)
