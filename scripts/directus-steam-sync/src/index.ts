import { processSteamGamesForMultipleUsers } from "./handlers/steam";
import { upsertAllSteamGames } from "./handlers/directus";
import { ArgumentParser } from "argparse";
import { createLogger } from "./utils/logger";

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
  parser.add_argument("-s", "--steam-ids", {
    nargs: "*",
    type: "str",
    help: "specific Steam IDs; if omitted Steam games will not be processed",
  });
  parser.add_argument("-l", "--language", {
    type: "str",
    help: "language for Steam data (default: english)",
  });

  const args = parser.parse_args();

  const logger = createLogger(args.verbose);

  logger.info("verbose = %s", args.verbose || false);
  logger.info("no_cache = %s", args.no_cache || false);

  logger.info("steam_ids (#) = %d", args.steam_ids ? args.steam_ids.length : 0);
  logger.info("language = %s", args.language || "english");

  // STEAM:

  if (args.steam_ids.length > 0) {
    const steamGames = await processSteamGamesForMultipleUsers(
      args.steam_ids,
      {
        debug: args.verbose || false,
        language: args.language || "english",
        useCache: !args.no_cache,
      },
      logger,
    );

    await upsertAllSteamGames(steamGames, logger);
  }
}

void main();
