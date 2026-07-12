F3 Midlands API Fix v4

This patch corrects the false "incomplete data" failure from the F3 Nation
map endpoint. The endpoint's totalCount includes events without locations,
while its returned events list uses an inner location join and excludes them.
Those records cannot be shown on a map or directions card anyway.

Copy this folder over the repository root and overwrite:
  scripts/sync-f3-aos.mjs

No workflow or secret changes are required.
