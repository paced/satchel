# satchel

## Scripts

Scripts are all written in TypeScript and use Moonrepo for monorepo management.

### Sync Directus with Steam Library (directus-steam-sync)

Given the steam library provided in `.env`, the script with sync the Directus collection `Game` with the games in the
given account ID's library. This will add any missing games, as well as add any additional metadata to old entries.

The game info cache file is not `.gitignore`d as the Steam Store API output may be very useful for other users who have
similar game libraries. If you end up using this, please consider opening PRs with your own updates to the data!
