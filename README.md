# F3 Midlands F3 Nation time parser fix v10

Replace this file in the repository:

- `scripts/sync-f3-aos.mjs`

## Cause of the failure

The official F3 Nation map event endpoint returns compact schedule times such as:

- `0530`
- `0615`

The previous parser only accepted colon-delimited values such as `05:30`, so the
153 correctly matched Midlands events were discarded while schedules were built.

## What this patch supports

- `0530`
- `530`
- `05:30`
- `05:30:00`
- `5:30 AM`

All AO names, organization metadata, workout records, addresses, coordinates,
directions URLs, counts, filters, and schedules remain sourced from F3 Nation.

The patch was syntax-checked and fixture-tested using compact F3 Nation times.
