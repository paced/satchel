import LOGGER from "../logger";
import { config } from "dotenv";
import {
  loadGameInfoCache,
  loadKnownDeletedGamesCache,
  loadOwnedGamesCache,
  updateKnownDeletedGamesCache,
  updateOwnedGamesCache,
  updateSteamGameInfoCache,
} from "./caches";

const { parsed } = config({ quiet: true });

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

const STEAM_API_ENDPOINT = "https://api.steampowered.com";
const STEAM_STORE_API_ENDPOINT = "https://store.steampowered.com/api";

const STEAM_API_GET_OWNED_GAMES_METHOD = "IPlayerService/GetOwnedGames/v0001";
const STEAM_STORE_API_APP_DETAILS_METHOD = "appdetails";

/**
 * Delay between Steam Store API requests to avoid rate limiting.
 *
 * ## Notes
 *
 * Steam does not publish official rate limits for their Store API, but based on experience and community reports, they
 * are aggressive in rate limiting requests. A delay of 3 seconds between requests is a conservative approach to avoid
 * hitting rate limits, as temporary bans can last from several minutes to hours.
 *
 * For a game library with 1000 games, this results in this first step taking a very long time without caching.
 *
 * At your own risk, you can reduce this delay and accept rate limits, running the script again with caching enabled to
 * continue with unprocessed games. However, be aware that excessive requests may lead to longer bans.
 */
const STEAM_STORE_API_SLEEP_MS = 3000;

const DEFAULT_PROCESS_GAME_OPTIONS: ProcessGamesOptions = {
  useCache: true,
  skip: false,
};

export interface ProcessedSteamGameInfo {
  appId: number;
  name: string;

  detailed_description: string;
  about_the_game: string;
  short_description: string;

  header_image: string;
  capsule_image: string;
  capsule_imagev5: string;
  movies: any[];
  screenshots: any[];
  background: string;
  background_raw: string;

  developers: string[];
  publishers: string[];

  metacritic_score: number | null;

  categories: string[];
  genres: string[];
}

interface ProcessGamesOptions {
  /**
   * Whether to use the existing game info cache to avoid re-fetching data from the Steam Store API.
   */
  useCache?: boolean;

  /**
   * Whether to skip processing games entirely.
   *
   * This is useful when you know that no games need to be processed.
   *
   * ## Notes
   *
   * If this is set to true, then the cache must be used as well, or else the function will return nothing. It is
   * generally advisable to not use the skip option since this script can handle for games known to be deleted from
   * Steam gracefully.
   */
  skip?: boolean;
}

/**
 * Fetches and "processes" the games owned by a Steam user, most likely the user associated with the API key.
 *
 * ## How this works
 *
 * 1. Calls the Steam Web API to get the list of the owned games for a user. This is a fast endpoint and is likely to
 *    changed frequently for those who feel the need to use this script, so this is not cached.
 * 2. Each game is processed by calling the Steam API for each game. This information changes infrequently so this is
 *    cached by default in the game info cache file. Cache misses will target the Steam API with a delay to avoid rate
 *    limits.
 * 3. Finally, the games are saved to out/processed-games-<date>.json to speed up the Directus import part later, or
 *    any other script that may want to use this data. However, when running the entire script, the return of this
 *    function is used directly to import into Directus without more file I/O.
 *
 * @param options {ProcessGamesOptions} options for processing games
 * @returns {Promise<ProcessedSteamGameInfo[]>} the processed game information
 */
export async function processSteamGames(
  options: ProcessGamesOptions = DEFAULT_PROCESS_GAME_OPTIONS,
): Promise<ProcessedSteamGameInfo[]> {
  const finalOptions: ProcessGamesOptions = {
    ...DEFAULT_PROCESS_GAME_OPTIONS,
    ...options,
  };

  if (finalOptions.skip && !finalOptions.useCache) {
    LOGGER.error("skip option is set to true but useCache is false, which will result in no data being returned");
  }

  const ownedSteamAppIds: number[] = await fetchOwnedGames(!finalOptions.skip);
  const cachedGameInfos: ProcessedSteamGameInfo[] = finalOptions.useCache ? await loadGameInfoCache() : [];
  const knownDeletedAppIds: number[] = await loadKnownDeletedGamesCache();

  const gameInfos: ProcessedSteamGameInfo[] = [];
  const failedGameInfos: number[] = [];

  LOGGER.info("---------");
  LOGGER.info("FINDING DETAILS ABOUT OWNED STEAM GAMES");
  LOGGER.info("---------");

  for (const appId of ownedSteamAppIds) {
    if (!finalOptions.skip) {
      logFetchProgress(ownedSteamAppIds.length, ownedSteamAppIds.indexOf(appId) + 1);
    }

    const existingGameIndex = gameInfos.findIndex((gi) => gi.appId === appId);
    if (existingGameIndex !== -1) {
      LOGGER.debug("duplicate app ID %d found, skipping duplicate", appId);

      continue;
    }

    const cachedGameInfo = cachedGameInfos.find((cached) => cached.appId === appId);
    if (cachedGameInfo) {
      LOGGER.debug("using cached data for app ID %d", appId);
      gameInfos.push(cachedGameInfo);

      continue;
    }

    if (knownDeletedAppIds.includes(appId)) {
      LOGGER.debug("skipping known deleted app ID %d", appId);
      failedGameInfos.push(appId);

      continue;
    }

    // Skip must happen here to allow loading from cache above.

    if (finalOptions.skip) {
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, STEAM_STORE_API_SLEEP_MS));

    const appData = await lookupSteamGame(appId);
    if (!appData || !appData[appId] || !appData[appId].success) {
      LOGGER.warn(`failure for app ID %d, it may have been removed from Steam!`, appId);
      failedGameInfos.push(appId);

      if (appData[appId] && appData[appId].success === false) {
        knownDeletedAppIds.push(appId);
      }

      continue;
    }

    const parsedGameInfo = mapSteamAppToProcessedGameInfo(appData[appId].data);
    if (parsedGameInfo) {
      gameInfos.push(parsedGameInfo);
    }
  }

  if (failedGameInfos.length > 0) {
    LOGGER.warn(`could not/skipped process %d games`, failedGameInfos.length);
    failedGameInfos.forEach((game) => {
      LOGGER.warn(` - app ID ${game}`);
    });
  }

  if (finalOptions.useCache) {
    await updateSteamGameInfoCache(cachedGameInfos, gameInfos);
    await updateKnownDeletedGamesCache(knownDeletedAppIds);
  }

  return gameInfos;
}

async function fetchOwnedGames(force = false) {
  LOGGER.info("---------");
  LOGGER.info("DETERMINING USER'S STEAM GAMES");
  LOGGER.info("---------");

  if (!force) {
    return await loadOwnedGamesCache(TARGET_STEAM_ID);
  }

  LOGGER.info("(re)fetching library games for SteamID %s...", TARGET_STEAM_ID);

  const steamApiUrl = new URL(`${STEAM_API_ENDPOINT}/${STEAM_API_GET_OWNED_GAMES_METHOD}/`);

  steamApiUrl.searchParams.append("key", STEAM_API_KEY);
  steamApiUrl.searchParams.append("steamid", TARGET_STEAM_ID);
  steamApiUrl.searchParams.append("format", "json");

  const steamApiUrlString = steamApiUrl.href;

  LOGGER.debug("fetching Steam data from URL: %s...", steamApiUrlString);

  const result = await fetch(steamApiUrlString);

  const data = await result.json();

  const gameCount = data.response.game_count;
  const games = data.response.games;

  LOGGER.info(`...(re)fetch complete; user has %d games in their library`, gameCount);

  const appIds: number[] = [];
  games.forEach((game: any) => {
    appIds.push(game.appid);
  });

  await updateOwnedGamesCache(TARGET_STEAM_ID, appIds);

  return appIds;
}

function logFetchProgress(basicGameInfoLength: number, iterationIndexFromOne: number) {
  let modulo = 10;
  if (basicGameInfoLength > 1000) {
    modulo = 100;
  } else if (basicGameInfoLength > 500) {
    modulo = 50;
  } else if (basicGameInfoLength > 100) {
    modulo = 20;
  }

  if (iterationIndexFromOne % modulo === 0 || iterationIndexFromOne === basicGameInfoLength) {
    LOGGER.info(
      `progress: processing game %d of %d (%d)\%`,
      iterationIndexFromOne,
      basicGameInfoLength,
      Math.round((iterationIndexFromOne / basicGameInfoLength) * 100),
    );
  }
}

async function lookupSteamGame(appId: number) {
  const steamStoreApiUrl = new URL(`${STEAM_STORE_API_ENDPOINT}/${STEAM_STORE_API_APP_DETAILS_METHOD}/`);

  steamStoreApiUrl.searchParams.append("appids", appId.toString());

  const steamStoreApiUrlString = steamStoreApiUrl.href;

  LOGGER.debug("fetching Steam Store data from URL: %s", steamStoreApiUrlString);

  try {
    const result = await fetch(steamStoreApiUrlString);
    if (result.status === 429) {
      LOGGER.error("rate limited by Steam Store API");

      return;
    }

    return await result.json();
  } catch (_err) {
    LOGGER.error(`failed to fetch app ID %d and not rate limited`, appId);
  }
}

function mapSteamAppToProcessedGameInfo(data: any): ProcessedSteamGameInfo | undefined {
  try {
    return {
      appId: data.appId,
      name: data.name,

      // For Directus, only the short description is actually used.

      detailed_description: data.detailed_description,
      about_the_game: data.about_the_game,
      short_description: data.short_description,

      // For Directus, only the header image of all of these is actually used.

      header_image: data.header_image,
      capsule_image: data.capsule_image,
      capsule_imagev5: data.capsule_imagev5,
      movies: data.movies || [],
      screenshots: data.screenshots || [],
      background: data.background,
      background_raw: data.background_raw,

      developers: data.developers,
      publishers: data.publishers,

      metacritic_score: data.metacritic ? data.metacritic.score : null,

      // Genre is considered a category in Directus.

      categories: data.categories ? data.categories.map((category: any) => category.description) : [],
      genres: data.genres ? data.genres.map((genre: any) => genre.description) : [],
    };
  } catch (err) {
    LOGGER.error(`failed to process app ID %d: %s`, data.appId, err);
  }
}
