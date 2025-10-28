```json5
		// === Citations Configuration ===
		// This feature is currently unsupported and may change.
		citations: {
			// If true, a "Cite this page" section will be added to each page.
			"add-cite-this-post-section": false,
			// Configure how BibTeX citations are extracted and processed.
			"extract-and-process-bibtex-citations": {
				// If true, enables BibTeX citation processing.
				enabled: false,
				// Supported .bib file sources: GitHub Gist, GitHub repo file, Dropbox, and Google Drive public share links.
				// Google drive and dropbox links do not provide public last-updated timestamps; these files will be fetched and processed on every build and increase processing time, but https://retorque.re/zotero-better-bibtex/ can auto-update and auto sync them.
				//Gitub links will be checked for last-updated timestamps to avoid unnecessary re-processing but will need push or scripted auto-push to keep updated.
				"bibtex-file-url-list": [],
				// The shortcode or pattern for in-text citations. Supports #cite(key) for support with typst, \cite{key} for support with latex, and for support with pandoc [@key]. This will be rendered as [firstName et al, year] or [1][2] in text. Only one format is supported at a time.
				"in-text-citation-format": "[@key]",
				// The citation style for the bibliography (e.g., "apa", "ieee", "simplified-ieee"). Only one format is supported at a time.
				"bibliography-format": {
					//For ICML/ReNeurIPS style simplified ieee is used.
					"simplified-ieee": true,
					//For other academic writing APA (ACL is a pared down version of this) is used.
					apa: false,
				},
				// If true, a collated bibliography section will be automatically generated at the bottom of the page.
				"generate-bibliography-section": true,
			},
		},
	```

Objective

Enable page-level citations, BibTeX processing from external sources, and automatic bibliography generation for Webtrotion-powered websites.

⸻

Core Features

1. “Cite This Page” Section
	*	Appears at the end of each post, after footnotes but before interlinked content.
	*	Automatically generates a BibTeX entry for the current page.
	*	Displayed in a code block for easy copying.
	*	Can be toggled on or off via configuration.

2. BibTeX Citation Processing
	*	Supports linking to public .bib files from:
	*	GitHub Gist
	*	GitHub Repo
	*	Dropbox
	*	Google Drive
	*	Multiple .bib file URLs can be provided.
	*	Automatically extracts and processes entries.
	*	Normalizes share links to direct-download URLs and provides instructions or endpoints for last-updated timestamps.

Source Conversion & Timestamp Handling (inputs inlclude real files):

1. GitHub Gist
	*	Input: https://gist.github.com/nerdymomocat/dd0ea3c71898e6d7557d0b2a6b0f95f5
	*	Download URL: https://gist.githubusercontent.com/nerdymomocat/dd0ea3c71898e6d7557d0b2a6b0f95f5/raw
	*	Updated URL: https://api.github.com/gists/dd0ea3c71898e6d7557d0b2a6b0f95f5
	*	Timestamp Retrieval:

curl -s https://api.github.com/gists/dd0ea3c71898e6d7557d0b2a6b0f95f5 | jq '.updated_at'


⸻

2. GitHub Repo File
	*	Input: https://github.com/nerdymomocat-templates/bibfile-tester-webtrotion/blob/main/bibtex-test-webtr-github.bib
	*	Download URL: https://raw.githubusercontent.com/nerdymomocat-templates/bibfile-tester-webtrotion/main/bibtex-test-webtr-github.bib
	*	Updated URL: https://api.github.com/repos/nerdymomocat-templates/bibfile-tester-webtrotion/commits?path=bibtex-test-webtr-github.bib
	*	Timestamp Retrieval:

curl -s https://api.github.com/repos/nerdymomocat-templates/bibfile-tester-webtrotion/commits\?path=bibtex-test-webtr-github.bib | jq '.[0].commit.committer.date'

⸻

3. Dropbox Shared File
	*	Input: https://www.dropbox.com/scl/fi/vrtoh0mi2hsjwybu9s6gb/bibtex-test-webtr-dropbox.bib?rlkey=ry9qucvgh9kjs4nhgqe3jlq03&st=3lco5bnx&dl=0
	*	Download URL: https://www.dropbox.com/scl/fi/vrtoh0mi2hsjwybu9s6gb/bibtex-test-webtr-dropbox.bib?dl=1
	*	Updated URL: None
	*	Notes: Dropbox shared links do not expose public timestamps; use Dropbox API for server_modified.

⸻

4. Google Drive Shared File
	*	Input: https://drive.google.com/file/d/1GC98kFZeR1aUGIK1q8-9RirTTnQHl0KC/view?usp=sharing
	*	Download URL: https://drive.google.com/uc?export=download&id=1GC98kFZeR1aUGIK1q8-9RirTTnQHl0KC
	*	Updated URL: None
	*	Notes: Google Drive shared links do not expose public timestamps; use Drive API for modifiedTime.

⸻

5. Unknown / Unsupported Source
	*	Download URL: Original link
	*	Updated URL: None
	*	Notes: Only GitHub Gist, GitHub Repo, Dropbox, and Google Drive are supported.

Helper Function: get_bib_source_info()
	*	Purpose: Convert a share link to a direct-download URL and provide a method to check last update (if possible).
	*	Returns a dict:

{
  "source": "github",
  "download_url": "https://raw.githubusercontent.com/user/repo/main/path/to/mycollection.bib",
  "updated_url": "https://api.github.com/repos/user/repo/commits?path=path/to/mycollection.bib",
  "updated_instructions": "Use `curl -s ... | jq '.[0].commit.committer.date'` to get last modified timestamp."
}

The downloaded bib file would then be processed into the format decided and stored in json format with key, attribution replacement and the formatted entry. This can also be cached for performance. With github and and gist we can use the updated_url to check if the file has changed since last fetch based on LAST BUILD TIME variable. Otherwise we'll have to fetch and process every time. You'll probably need to store in json in tmp somewhere url, last updated, respective processed entries bib file, as well downladed file name. make sure whatever library we use for this, we keep as small as possible, tree-shake it if possible.

3. In-Text Citation Shortcodes
	*	Recognizes: #cite(key), \cite{key}, [@key]
	*	Renders in-text as [Author et al., Year]. This would have popover that shows the formatted entry on hover/click similar to footnotes (but automatically) which can be mapped based on the processed bibtex entries from the previous step.
	* We use [Author et al., Year] format for apa and [1][2] format for simplified-ieee.
	* Remember numbering is difficult because keys can be repeated and we want to number in order of first appearance. We will be populating a dict of number, key anyway, but I wanted to mention this.

4. Bibliography Formatting
	*	Automatically generates a bibliography section at the end of the post for all keys used in a page ordered alphabetically for apa. For simplified-ieee ordered by appearance. Only fitlers to those used on a page.
	*	Supports APA, and Simplified IEEE (used in iclr/neurips etc) styles (uses numbering, same numbering assigned in order).
	* These days papers sometimes have 500 authors, in which case, let's cap it to max 8 authors then et al.
	* If section is enabled in config, it would be rendered after interlinked content. Similar to interlinked content, add at [marker] [marker] where each marker is the backlink to the block which used the key for this formatted entry and will behave the same way (hover/click to show popover original block without reference).

The thing to note here is if there is a citation inside footnote content, we do process them too and in formatted entry backlink it links to the block which had the footnote marker or if margin is enabled and visible, then to the margin citation content.

The section and processing will happen for the locations footnotes are added: src/pages/[...page].astro, src/pages/posts/[slug].astro and src/components/blog/PostPreviewFull.astro

Moonshot:  when someone clicks jump to bibliography, add a button (similar to jump to top) but diff in a sense that clicking this button will jump to the
block where they clicked jump to bibliography. how will you do it?
