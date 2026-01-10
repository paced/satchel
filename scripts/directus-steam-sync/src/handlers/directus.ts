import { createDirectus, createItem, readItems, rest, staticToken, updateItem } from "@directus/sdk";
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

const STEAM_STORE_URL_BASE = "https://store.steampowered.com/app";

const DIRECTUS_GAME_COLLECTION_NAME = "Game";

const DIRECTUS_GAME_STEAM_ID_KEY = "Steam_ID";
const DIRECTUS_GAME_NAME_KEY = "Name";
const DIRECTUS_GAME_DEVELOPERS_KEY = "Developers";
const DIRECTUS_GAME_PUBLISHERS_KEY = "Publishers";
const DIRECTUS_GAME_MARKETPLACE_KEY = "Marketplace";
const DIRECTUS_GAME_URL_KEY = "URL";
const DIRECTUS_GAME_THUMBNAIL_KEY = "Thumbnail";
const DIRECTUS_GAME_DESCRIPTION_KEY = "Description";
const DIRECTUS_GAME_TAGS_KEY = "Tags";

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

export async function upsertAllSteamGames(steamGameData: ProcessedSteamGameInfo[]) {
  // App IDs do NOT match Directus item IDs. We need to always retrieve first.

  LOGGER.info("---------");
  LOGGER.info("RETRIEVING EXISTING GAMES FROM DIRECTUS");
  LOGGER.info("---------");

  const existingGames = await fetchExistingGames();
  const steamAppIdToDirectusItemIdMap = createSteamAppIdToDirectusItemIdMap(existingGames);

  LOGGER.info("---------");
  LOGGER.info("UPSERTING GAMES TO DIRECTUS");
  LOGGER.info("---------");

  for (const gameData of steamGameData) {
    const directusItemId = steamAppIdToDirectusItemIdMap[gameData.appId]?.id;

    // TODO: This is extremely spammy for a large amount of games, but useful. Change to debug and for info, set to
    //       modulo-based logging.

    if (directusItemId) {
      LOGGER.info(
        "updating existing Directus item ID %d for Steam App ID %d (%s)",
        directusItemId,
        gameData.appId,
        gameData.name,
      );
    } else {
      LOGGER.info("creating new Directus item for Steam App ID %d (%s)", gameData.appId, gameData.name);
    }

    // Note any of the Steam data below can and should be overridden, while the other values remain unchanged.

    const data = {
      collection: DIRECTUS_GAME_COLLECTION_NAME,
      [DIRECTUS_GAME_NAME_KEY]: gameData.name,
      [DIRECTUS_GAME_DEVELOPERS_KEY]: gameData.developers,
      [DIRECTUS_GAME_PUBLISHERS_KEY]: gameData.publishers,
      [DIRECTUS_GAME_MARKETPLACE_KEY]: "Steam",
      [DIRECTUS_GAME_URL_KEY]: `${STEAM_STORE_URL_BASE}/${gameData.appId}`,
      [DIRECTUS_GAME_THUMBNAIL_KEY]: gameData.header_image,
      [DIRECTUS_GAME_DESCRIPTION_KEY]: gameData.short_description,
      [DIRECTUS_GAME_TAGS_KEY]: [...gameData.genres, ...gameData.categories],
      [DIRECTUS_GAME_STEAM_ID_KEY]: gameData.appId,
    };

    if (directusItemId) {
      try {
        await DIRECTUS_CLIENT.request(updateItem(DIRECTUS_GAME_COLLECTION_NAME, directusItemId, data));
      } catch (err) {
        LOGGER.error(
          "failed to update Directus item ID %d for Steam App ID %d (%s): %s",
          directusItemId,
          gameData.appId,
          gameData.name,
          JSON.stringify(err, null, 2),
        );
        LOGGER.error("one failure here means others will likely fail; aborting");

        process.exit(1);
      }
    } else {
      try {
        await DIRECTUS_CLIENT.request(createItem(DIRECTUS_GAME_COLLECTION_NAME, data));
      } catch (err) {
        LOGGER.error(
          "failed to create Directus item for Steam App ID %d (%s): %s",
          gameData.appId,
          gameData.name,
          JSON.stringify(err, null, 2),
        );
        LOGGER.error("one failure here means others will likely fail; aborting");

        process.exit(1);
      }
    }
  }
}

function createSteamAppIdToDirectusItemIdMap(existingGames: Record<number, any>): Record<number, any> {
  const map: Record<number, number> = {};

  Object.values(existingGames).forEach((item: any) => {
    map[item[DIRECTUS_GAME_STEAM_ID_KEY]] = item;
  });

  return map;
}

async function fetchExistingGames(): Promise<Record<number, any>> {
  const existingGames: Record<number, any> = {};

  LOGGER.info("fetching existing Directus games...");

  for (let page = 1; page <= DIRECTUS_MAX_PAGES; page++) {
    LOGGER.debug("fetching existing Directus games, page %d", page);

    const response = await fetchExistingGamesPage(page);

    if (response.length === 0) {
      LOGGER.debug("no more existing Directus games found, stopping at page %d", page);

      break;
    }

    response.forEach((record) => {
      // "id" is never expected to change, and always expected to be the Directus item ID.

      existingGames[record.id] = record;
    });
  }

  LOGGER.info("fetched %d game items", Object.keys(existingGames).length);

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
