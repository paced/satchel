import { createDirectus, createItem, readItems, rest, staticToken, updateItem } from "@directus/sdk";
import { config } from "dotenv";
import { Logger } from "pino";
import { ProcessedSteamGameInfo } from "./steam/types";
import { logProgress } from "../utils/logger";

const { parsed } = config({ quiet: true });

const DIRECTUS_API_ENDPOINT = parsed?.DIRECTUS_API_ENDPOINT || "";
const DIRECTUS_API_TOKEN = parsed?.DIRECTUS_API_TOKEN || "";

const STEAM_STORE_URL_BASE = "https://store.steampowered.com/app";

const DIRECTUS_GAME_COLLECTION_NAME = "Game";

const DIRECTUS_GAME_STEAM_ID_KEY = "Steam_ID";
const DIRECTUS_GAME_NAME_KEY = "Name";
const DIRECTUS_GAME_DEVELOPERS_KEY = "Developers";
const DIRECTUS_GAME_PUBLISHERS_KEY = "Publishers";
const DIRECTUS_GAME_MARKETPLACE_KEY = "Marketplace";
const DIRECTUS_GAME_URL_KEY = "URL";
const DIRECTUS_GAME_THUMBNAIL_KEY = "Thumbnail";
const DIRECTUS_GAME_SCREENSHOTS_KEY = "Screenshots";
const DIRECTUS_GAME_DESCRIPTION_KEY = "Description";
const DIRECTUS_GAME_TAGS_KEY = "Tags";
const DIRECTUS_GAME_METACRITIC_SCORE_KEY = "Metacritic_Score";
const DIRECTUS_GAME_REVIEW_CATEGORY_KEY = "Review_Category";
const DIRECTUS_GAME_STEAM_TOTAL_REVIEWS_KEY = "Steam_Total_Reviews";
const DIRECTUS_GAME_STEAM_POSITIVE_REVIEWS_KEY = "Steam_Positive_Reviews";
const DIRECTUS_GAME_STEAM_NEGATIVE_REVIEWS_KEY = "Steam_Negative_Reviews";
const DIRECTUS_GAME_LAST_PLAYED_KEY = "Last_Played";
const DIRECTUS_GAME_HOURS_KEY = "Hours";
const DIRECTUS_GAME_HLTB_HOURS_KEY = "HLTB_Hours";
const DIRECTUS_GAME_HLTB_HOURS_EXTRA_KEY = "HLTB_Hours_Extra";
const DIRECTUS_GAME_HLTB_HOURS_COMPLETIONIST_KEY = "HLTB_Hours_Completionist";
const DIRECTUS_GAME_HLTB_NAME_KEY = "HLTB_Name";
const DIRECTUS_GAME_HLTB_URL_KEY = "HLTB_URL";
const DIRECTUS_GAME_RELEASE_DATE_KEY = "Release_Date";
const DIRECTUS_GAME_STEAM_SPY_AVERAGE_FOREVER_KEY = "Spy_Average_Forever";
const DIRECTUS_GAME_STEAM_SPY_AVERAGE_2_WEEKS_KEY = "Spy_Average_2_Weeks";
const DIRECTUS_GAME_STEAM_SPY_MEDIAN_FOREVER_KEY = "Spy_Median_Forever";
const DIRECTUS_GAME_STEAM_SPY_MEDIAN_2_WEEKS_KEY = "Spy_Median_2_Weeks";
const DIRECTUS_GAME_STEAM_SPY_TAGS_KEY = "Spy_Tags";

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

export async function upsertAllSteamGames(steamGameData: ProcessedSteamGameInfo[], logger: Logger) {
  // App IDs do NOT match Directus item IDs. We need to always retrieve first.

  logger.info("---------");
  logger.info("RETRIEVING EXISTING GAMES FROM DIRECTUS");
  logger.info("---------");

  const existingGames = await fetchExistingGames(logger);
  const steamAppIdToDirectusItemIdMap = createSteamAppIdToDirectusItemIdMap(existingGames);

  logger.info("---------");
  logger.info("UPSERTING GAMES TO DIRECTUS");
  logger.info("---------");

  for (const gameData of steamGameData) {
    const directusItemId = steamAppIdToDirectusItemIdMap[gameData.appId]?.id;

    logProgress(steamGameData.indexOf(gameData) + 1, steamGameData.length, "Directus upsert", logger);

    if (directusItemId) {
      logger.debug(
        "updating existing Directus item ID %d for Steam App ID %d (%s)",
        directusItemId,
        gameData.appId,
        gameData.name,
      );
    } else {
      logger.debug("creating new Directus item for Steam App ID %d (%s)", gameData.appId, gameData.name);
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
      [DIRECTUS_GAME_SCREENSHOTS_KEY]: gameData.screenshots.map((screenshot) => screenshot.path_full).join("\n"),
      [DIRECTUS_GAME_DESCRIPTION_KEY]: gameData.short_description,
      [DIRECTUS_GAME_TAGS_KEY]: [...gameData.genres, ...gameData.categories],
      [DIRECTUS_GAME_STEAM_ID_KEY]: gameData.appId,
      [DIRECTUS_GAME_METACRITIC_SCORE_KEY]: gameData.metacritic_score,
      [DIRECTUS_GAME_REVIEW_CATEGORY_KEY]: gameData.review_category || null,
      [DIRECTUS_GAME_STEAM_TOTAL_REVIEWS_KEY]: gameData.total_reviews || 0,
      [DIRECTUS_GAME_STEAM_POSITIVE_REVIEWS_KEY]: gameData.total_positive_reviews || 0,
      [DIRECTUS_GAME_STEAM_NEGATIVE_REVIEWS_KEY]: gameData.total_negative_reviews || 0,
      [DIRECTUS_GAME_LAST_PLAYED_KEY]: gameData.basicData?.isAdmin ? gameData.basicData?.lastPlayed || null : null,
      [DIRECTUS_GAME_HOURS_KEY]: gameData.basicData?.isAdmin ? gameData.basicData?.hours || 0 : 0,
      [DIRECTUS_GAME_HLTB_HOURS_KEY]: gameData.hltb_hours || null,
      [DIRECTUS_GAME_HLTB_HOURS_EXTRA_KEY]: gameData.hltb_hours_extra || null,
      [DIRECTUS_GAME_HLTB_HOURS_COMPLETIONIST_KEY]: gameData.hltb_hours_completionist || null,
      [DIRECTUS_GAME_HLTB_NAME_KEY]: gameData.hltb_name || null,
      [DIRECTUS_GAME_HLTB_URL_KEY]: gameData.hltb_url || null,
      [DIRECTUS_GAME_RELEASE_DATE_KEY]: gameData.release_date_timestamp
        ? new Date(gameData.release_date_timestamp).toISOString()
        : null,
      [DIRECTUS_GAME_STEAM_SPY_AVERAGE_FOREVER_KEY]: gameData.spy_average_forever || 0,
      [DIRECTUS_GAME_STEAM_SPY_AVERAGE_2_WEEKS_KEY]: gameData.spy_average_2weeks || 0,
      [DIRECTUS_GAME_STEAM_SPY_MEDIAN_FOREVER_KEY]: gameData.spy_median_forever || 0,
      [DIRECTUS_GAME_STEAM_SPY_MEDIAN_2_WEEKS_KEY]: gameData.spy_median_2weeks || 0,
      [DIRECTUS_GAME_STEAM_SPY_TAGS_KEY]: gameData.spy_tags,
    };

    if (directusItemId) {
      try {
        await DIRECTUS_CLIENT.request(updateItem(DIRECTUS_GAME_COLLECTION_NAME, directusItemId, data));
      } catch (err) {
        logger.error(
          "failed to update Directus item ID %d for Steam App ID %d (%s): %s",
          directusItemId,
          gameData.appId,
          gameData.name,
          JSON.stringify(err, null, 2),
        );
        logger.error("one failure here means others will likely fail; aborting");

        process.exit(1);
      }
    } else {
      try {
        // When creating, there's a chance that there's a duplicate name either from the same game owned on a different
        // platform, or from a game twice in the same platform. In this case, we need to check it and do an update
        // instead, or accepting the existing item if it is "better." For Steam games, it means the Hours value is not
        // zero, or the Metacritic score isn't null.

        // TODO: Handle for this.

        await DIRECTUS_CLIENT.request(createItem(DIRECTUS_GAME_COLLECTION_NAME, data));
      } catch (err) {
        logger.error(
          "failed to create Directus item for Steam App ID %d (%s): %s",
          gameData.appId,
          gameData.name,
          JSON.stringify(err, null, 2),
        );
        logger.error("one failure here means others will likely fail; aborting");

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

async function fetchExistingGames(logger: Logger): Promise<Record<number, any>> {
  const existingGames: Record<number, any> = {};

  logger.info("fetching existing Directus games...");

  for (let page = 1; page <= DIRECTUS_MAX_PAGES; page++) {
    logger.debug("fetching existing Directus games, page %d", page);

    const response = await fetchExistingGamesPage(page);

    if (response.length === 0) {
      logger.debug("no more existing Directus games found, stopping at page %d", page);

      break;
    }

    response.forEach((record) => {
      // "id" is never expected to change, and always expected to be the Directus item ID.

      existingGames[record.id] = record;
    });
  }

  logger.info("fetched %d game items", Object.keys(existingGames).length);

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
