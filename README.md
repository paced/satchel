# satchel

Scripts are all written in TypeScript and use Moonrepo for monorepo management.

## Sync Directus with Steam Library (directus-steam-sync)

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
