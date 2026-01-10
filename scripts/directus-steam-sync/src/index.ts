import { config } from "dotenv";
import { processGames } from "./handlers/steam";

const { parsed } = config();

const STEAM_API_KEY = parsed?.STEAM_API_KEY || "";
if (!STEAM_API_KEY) {
  throw new Error("[fatal] missing STEAM_API_KEY in envars");
}

const TARGET_STEAM_ID = parsed?.TARGET_STEAM_ID || "";
if (!TARGET_STEAM_ID) {
  throw new Error("[fatal] missing TARGET_STEAM_ID in envars");
}

async function main() {
  await processGames(STEAM_API_KEY, TARGET_STEAM_ID);
}

main().catch((err) => {
  console.error("[fatal] unhandled error:", err);
  process.exit(1);
});
