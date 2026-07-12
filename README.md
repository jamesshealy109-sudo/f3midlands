# Remove AO Website feature v11

Extract this patch into the root of the F3 Midlands repository and overwrite:

- `src/pages/index.astro`
- `src/styles/global.css`

This removes the visible **AO Website** button and its styling. Directions continue to use the location coordinates supplied by F3 Nation. The complete AO metadata, including the official website field, may remain in the generated API data as source-of-truth metadata but is no longer displayed or searchable on the website.
