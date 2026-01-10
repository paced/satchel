import { processSteamGames } from "./handlers/steam";
import { createLogger } from "./handlers/logger";
import { upsertAllSteamGames } from "./handlers/directus";
import { ArgumentParser } from "argparse";

async function main() {
  const parser = new ArgumentParser({
    description: "syncing tool for game marketplaces to Directus",
  });

  parser.add_argument("-v", "--verbose", {
    action: "store_true",
    help: "enable verbose logging",
  });
  parser.add_argument("-n", "--no-cache", {
    action: "store_true",
    help: "disable cache usage, useful for refreshing Steam data",
  });
  parser.add_argument("--skip-steam-api-calls", {
    action: "store_true",
    help: "skip processing Steam data in rare cases where no Steam API calls are desired",
  });
  parser.add_argument("-s", "--steam-ids", {
    nargs: "*",
    type: "str",
    help: "specific Steam IDs; if omitted Steam games will not be processed",
  });

  const args = parser.parse_args();

  const logger = createLogger(args.verbose);

  logger.info("---------");
  logger.info("STARTING");
  logger.info("---------");

  logger.info("verbose = %s", args.verbose || false);
  logger.info("no_cache = %s", args.no_cache || false);
  logger.info("skip_steam = %s", args.skip_steam_api_calls || false);

  logger.info("steam_ids (#) = %d", args.steam_ids ? args.steam_ids.length : 0);

  if (args.steam_ids.length > 0) {
    const steamGames = await processSteamGames(
      args.steam_ids,
      {
        useCache: !args.no_cache,
        skip: args.skip,
      },
      logger,
    );

    await upsertAllSteamGames(steamGames, logger);
  }
}

main().catch((err) => {
  throw new Error("unhandled error: %s", err);
});
