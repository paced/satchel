import { processSteamGames } from "./handlers/steam";
import LOGGER from "./handlers/logger";
import { upsertAllSteamGames } from "./handlers/directus";
import { ArgumentParser } from "argparse";

async function main() {
  const parser = new ArgumentParser({
    description: "syncing tool for game marketplaces to Directus",
  });

  // TODO: Allow overriding envars by providing optional arguments.

  // TODO: Use this instead of DEBUG.
  parser.add_argument("-v", "--verbose", {
    action: "store_true",
    help: "enable verbose logging",
  });
  parser.add_argument("-n", "--no-cache", {
    action: "store_true",
    help: "disable cache usage, useful for refreshing Steam data",
  });
  parser.add_argument("-s", "--skip-steam", {
    action: "store_true",
    help: "skip processing Steam data in rare cases where no Steam API calls are desired",
  });

  const args = parser.parse_args();

  LOGGER.info("---------");
  LOGGER.info("STARTING");
  LOGGER.info("---------");

  LOGGER.info("verbose = %s", args.verbose || false);
  LOGGER.info("no_cache = %s", args.no_cache || false);
  LOGGER.info("skip_steam = %s", args.skip_steam || false);

  const steamGames = await processSteamGames({
    useCache: !args.no_cache,
    skip: args.skip,
  });

  await upsertAllSteamGames(steamGames);
}

main().catch((err) => {
  LOGGER.error("unhandled error: %s", err);
  process.exit(1);
});
