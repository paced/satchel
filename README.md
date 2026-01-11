# satchel

Scripts are all written in TypeScript and use Moonrepo for monorepo management.

## Sync Directus with Steam Library (directus-steam-sync)

This script fetches your Steam library information and syncs it with a Directus instance.

### Usage

```shell
pnpm start --help
```

An example usage would be (for two Steam IDs as part of the same Steam Family):

```shell
pnpm start -s 123456789 234567890
```

Most of the time, this is all you need; you do not need to think about the other options.

### Notes

The game info cache file is not `.gitignore`d as the Steam Store API output may be very useful for other users who have
similar game libraries. If you end up using this, please consider opening PRs with your own updates to the data!

- The file is getting large. It is a to-do item to reduce the size by paging it over multiple files, and to provide the
  language in the filename so other languages can also be cached.
- HLTB integration is broken and will be fixed in a future update by implementing the scraping directly.
- User-defined tags are also not yet implemented.
- "Gallery"-like viewing of screenshots is also not yet implemented.
- "Tags you've engaged with" is also not yet implemented.
- A recommendations engine is not yet implemented.
  - This will be based on a heuristic, not machine learning or generative AI.

## Swiper

- A sub-app that allows a simple button interface for adding statuses to items in Directus.
  - Slider: Replayability score (0-100).
  - Dropdown: Tier (S, A, B, C, D, E, F, unfinished) - only finished games allowed on here.
  - Buttons: "Completed, 100%", "Completed, Any%", "Dropped, 50%+ done", "Dropped, partially done", "Dropped, glanced",
    "Dropped, judged cover".

This allows setting nearly all fields in one convenient app. The only thing it doesn't let you do is set reviews, which
should be done directly in Directus to games that already have a tier.

Game information such as screenshots, marketplace/store links, IGDB, and HLTB links will be placed on the form to help
decide, along with a big Metacritic score if available.

### Usage

This is a React application. The production version requires you to input your Directus instance URL and token directly,
so unless you need to make local changes, there is no real need to run this locally.

Still, if you do:

```shell
pnpm run dev
```
