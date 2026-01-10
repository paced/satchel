import { processSteamGames } from "./handlers/steam";
import LOGGER from "./handlers/logger";
import { upsertAllSteamGames } from "./handlers/directus";

async function main() {
  // TODO: Control this with argparse.

  const steamGames = await processSteamGames();
  await upsertAllSteamGames(steamGames);
}

main().catch((err) => {
  LOGGER.error("unhandled error: %s", err);
  process.exit(1);
});
