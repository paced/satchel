import { config } from "dotenv";
import { processGames } from "./handlers/steam";
import LOGGER from "./handlers/logger";

const { parsed } = config();

const STEAM_API_KEY = parsed?.STEAM_API_KEY || "";
if (!STEAM_API_KEY) {
  LOGGER.error("missing STEAM_API_KEY in envars");
  process.exit(1);
}

const TARGET_STEAM_ID = parsed?.TARGET_STEAM_ID || "";
if (!TARGET_STEAM_ID) {
  LOGGER.error("missing TARGET_STEAM_ID in envars");
  process.exit(1);
}

async function main() {
  await processGames(STEAM_API_KEY, TARGET_STEAM_ID);
}

main().catch((err) => {
  LOGGER.error("unhandled error: %s", err);
  process.exit(1);
});
