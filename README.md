# satchel

## Scripts

Scripts are all written in TypeScript and use Moonrepo for monorepo management.

### Sync Directus with Steam Library (directus-steam-sync)

Given the steam library provided in `.env`, the script with sync the Directus collection `Game` with the games in the
given account ID's library. This will add any missing games, as well as add any additional metadata to old entries.

This uses the Steam Web API through `IPlayerService/GetOwnedGames/v0001/` to get the list of owned games.
