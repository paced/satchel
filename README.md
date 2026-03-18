# satchel

Scripts are all written in TypeScript and use Moonrepo for monorepo management.

## `directus-steam-sync`

This script fetches your Steam library information and syncs it with a Directus instance.

### Prerequisites

```shell
pnpm exec playwright install
```

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
