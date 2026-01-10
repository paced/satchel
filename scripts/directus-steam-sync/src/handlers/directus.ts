import { createDirectus, readItems, rest, staticToken } from "@directus/sdk";
import { config } from "dotenv";
import LOGGER from "./logger";
import { ProcessedSteamGameInfo } from "./steam";

const { parsed } = config({ quiet: true });

const DIRECTUS_API_ENDPOINT = parsed?.DIRECTUS_API_ENDPOINT;
if (!DIRECTUS_API_ENDPOINT) {
  LOGGER.error("missing DIRECTUS_API_ENDPOINT in envars");
  process.exit(1);
}

const DIRECTUS_API_TOKEN = parsed?.DIRECTUS_API_TOKEN;
if (!DIRECTUS_API_TOKEN) {
  LOGGER.error("missing DIRECTUS_API_TOKEN in envars");
  process.exit(1);
}

const DIRECTUS_GAME_COLLECTION_NAME = "Game";
const DIRECTUS_GAME_STEAM_ID_KEY = "Steam_ID";

/**
 * The total number of supported pages we'll attempt to fetch.
 *
 * ## Notes
 *
 * This means there's a limitation of 999k games that can be stored or retrieved. However, given that there are far
 * fewer than 100k games on Steam and in existence known today on digital platforms, this should be sufficient for the
 * well foreseeable future.
 */
const DIRECTUS_MAX_PAGES = 999;
const DIRECTUS_ITEMS_PAGE_SIZE = 1000;

const DIRECTUS_CLIENT = createDirectus(DIRECTUS_API_ENDPOINT).with(staticToken(DIRECTUS_API_TOKEN)).with(rest());

export async function upsertSteamGame(steamGameData: ProcessedSteamGameInfo[]) {
  // App IDs do NOT match Directus item IDs. We need to always retrieve first.

  await fetchExistingGames();
}

function createSteamAppIdToDirectusItemIdMap(existingGames: Record<number, any>): Record<number, number> {
  const map: Record<number, number> = {};

  Object.values(existingGames).forEach((item: any) => {
    map[item[DIRECTUS_GAME_STEAM_ID_KEY]] = item;
  });

  return map;
}

async function fetchExistingGames(): Promise<Record<number, any>> {
  const existingGames: Record<number, any> = {};

  for (let page = 1; page <= DIRECTUS_MAX_PAGES; page++) {
    LOGGER.debug("fetching existing Directus games, page %d", page);

    const response = await fetchExistingGamesPage(page);

    if (response.length === 0) {
      LOGGER.debug("no more existing Directus games found, stopping at page %d", page);

      break;
    }

    response.forEach((record) => {
      existingGames[record.steam_app_id] = record;
    });
  }

  LOGGER.debug("fetched games: %s", existingGames);

  return existingGames;
}

async function fetchExistingGamesPage(page: number) {
  return await DIRECTUS_CLIENT.request(
    readItems(DIRECTUS_GAME_COLLECTION_NAME, {
      offset: (page - 1) * DIRECTUS_ITEMS_PAGE_SIZE,
      limit: DIRECTUS_ITEMS_PAGE_SIZE,
    }),
  );
}
