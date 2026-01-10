import { config } from "dotenv";
import {
  loadGameInfoCache,
  loadKnownDeletedGamesCache,
  loadOwnedGamesCache,
  updateKnownDeletedGamesCache,
  updateOwnedGamesCache,
  updateSteamGameInfoCache,
} from "./caches";
import { Logger } from "pino";

const { parsed } = config({ quiet: true });

const STEAM_API_KEY = parsed?.STEAM_API_KEY || "";

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

/**
 * Threshold for what is considered a "long" time in milliseconds for warning the user.
 */
const LONG_TIME_IN_MS = 30 * 1000;

const DEFAULT_LANGUAGE = "english";
const DEFAULT_PROCESS_GAME_OPTIONS: ProcessGamesOptions = {
  debug: false,
  language: DEFAULT_LANGUAGE,
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
  debug?: boolean;
  language?: string;

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

// TODO: Make top level function where all the logs are and other functions more pure.

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
 * ## Notes
 *
 * Note that the cache is written multiple times if there are multiple target IDs. This is to ensure that if the script
 * is interrupted, the cache is still updated for previously processed users, and is currently relatively low-cost.
 *
 * @param targetIds {string} the target Steam IDs to process
 * @param options {ProcessGamesOptions} options for processing games
 * @param logger {Logger} the logger for the CLI
 * @returns {Promise<ProcessedSteamGameInfo[]>} the processed game information
 */
export async function processSteamGames(
  targetIds: string[],
  options: ProcessGamesOptions = DEFAULT_PROCESS_GAME_OPTIONS,
  logger: Logger,
): Promise<ProcessedSteamGameInfo[]> {
  const finalOptions: ProcessGamesOptions = {
    ...DEFAULT_PROCESS_GAME_OPTIONS,
    ...options,
  };

  if (finalOptions.skip && !finalOptions.useCache) {
    logger.error("skip option is set to true but useCache is false, which will result in no data being returned");
  }

  const combinedGames: ProcessedSteamGameInfo[] = [];
  for (const targetId of targetIds) {
    logger.info(
      "========= PROCESSING STEAM ID: %s (USER %d of %d) =========",
      targetId,
      targetIds.indexOf(targetId) + 1,
      targetIds.length,
    );

    const userGames = await processSteamGamesForSingleUser(targetId, finalOptions, logger);
    combinedGames.push(...userGames);
  }

  const uniqueGamesMap: Record<number, ProcessedSteamGameInfo> = {};
  combinedGames.forEach((game) => {
    uniqueGamesMap[game.appId] = game;
  });

  const uniqueGames = Object.values(uniqueGamesMap).sort((a, b) => a.appId - b.appId);

  logger.info("total unique Steam games processed across all users: %d", uniqueGames.length);

  return combinedGames;
}

async function processSteamGamesForSingleUser(targetSteamId: string, options: ProcessGamesOptions, logger: Logger) {
  const ownedSteamAppIds: number[] = await fetchOwnedGames(targetSteamId, !options.skip, logger);

  logger.info("---------");
  logger.info("FINDING DETAILS ABOUT OWNED STEAM GAMES");
  logger.info("---------");

  const cachedGameInfos: ProcessedSteamGameInfo[] = options.useCache ? await loadGameInfoCache() : [];
  const knownDeletedAppIds: number[] = options.useCache ? await loadKnownDeletedGamesCache() : [];

  const gameInfos: ProcessedSteamGameInfo[] = [];
  const failedGameInfos: number[] = [];

  const totalGamesExpectedToProcess = ownedSteamAppIds.length - cachedGameInfos.length - knownDeletedAppIds.length;
  if (!options.skip && totalGamesExpectedToProcess * STEAM_STORE_API_SLEEP_MS > LONG_TIME_IN_MS) {
    logger.warn(
      "processing %d games with a delay of %d ms each may take a long time (over %d seconds)...",
      totalGamesExpectedToProcess,
      STEAM_STORE_API_SLEEP_MS,
      Math.round((totalGamesExpectedToProcess * STEAM_STORE_API_SLEEP_MS) / 1000),
    );
  }

  logger.info("beginning processing of %d owned Steam games...", ownedSteamAppIds.length);

  for (const appId of ownedSteamAppIds) {
    if (!options.skip) {
      logFetchProgress(ownedSteamAppIds.length, ownedSteamAppIds.indexOf(appId) + 1, logger);
    }

    const existingGameIndex = gameInfos.findIndex((gi) => gi.appId === appId);
    if (existingGameIndex !== -1) {
      logger.debug("duplicate app ID %d found, skipping duplicate", appId);

      continue;
    }

    const cachedGameInfo = cachedGameInfos.find((cached) => cached.appId === appId);
    if (cachedGameInfo) {
      logger.debug("using cached data for app ID %d", appId);
      gameInfos.push(cachedGameInfo);

      continue;
    }

    if (knownDeletedAppIds.includes(appId)) {
      logger.debug("skipping known deleted app ID %d", appId);
      failedGameInfos.push(appId);

      continue;
    }

    // Skip must happen here to allow loading from cache above.

    if (options.skip) {
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, STEAM_STORE_API_SLEEP_MS));

    const appData = await lookupSteamGame(appId, options.language || DEFAULT_LANGUAGE, logger);
    if (!appData || !appData[appId] || !appData[appId].success) {
      logger.warn(`failure for app ID %d, it may have been removed from Steam!`, appId);
      failedGameInfos.push(appId);

      if (appData[appId] && appData[appId].success === false) {
        knownDeletedAppIds.push(appId);
      }

      continue;
    }

    const parsedGameInfo = mapSteamAppToProcessedGameInfo(appData[appId].data, logger);
    if (parsedGameInfo) {
      gameInfos.push(parsedGameInfo);
    }
  }

  if (failedGameInfos.length > 0) {
    logger.warn(`could not/skipped process %d games`, failedGameInfos.length);
    failedGameInfos.forEach((game) => {
      logger.warn(` - app ID ${game}`);
    });
  }

  if (options.useCache) {
    await updateSteamGameInfoCache(cachedGameInfos, gameInfos);
    await updateKnownDeletedGamesCache(knownDeletedAppIds);
  }

  return gameInfos;
}

async function fetchOwnedGames(targetSteamId: string, force = false, logger: Logger) {
  logger.info("---------");
  logger.info("DETERMINING USER'S STEAM GAMES");
  logger.info("---------");

  if (!force) {
    return await loadOwnedGamesCache(targetSteamId);
  }

  logger.info("(re)fetching library games for SteamID %s...", targetSteamId);

  const steamApiUrl = new URL(`${STEAM_API_ENDPOINT}/${STEAM_API_GET_OWNED_GAMES_METHOD}/`);

  steamApiUrl.searchParams.append("key", STEAM_API_KEY);
  steamApiUrl.searchParams.append("steamid", targetSteamId);
  steamApiUrl.searchParams.append("format", "json");

  const steamApiUrlString = steamApiUrl.href;

  logger.debug("fetching Steam data from URL: %s...", steamApiUrlString);

  const result = await fetch(steamApiUrlString);

  const data = await result.json();

  const gameCount = data.response.game_count;
  const games = data.response.games;

  logger.info(`...(re)fetch complete; user has %d games in their library`, gameCount);

  const appIds: number[] = [];
  games.forEach((game: any) => {
    appIds.push(game.appid);
  });

  await updateOwnedGamesCache(targetSteamId, appIds);

  return appIds;
}

function logFetchProgress(basicGameInfoLength: number, iterationIndexFromOne: number, logger: Logger) {
  let modulo = 10;
  if (basicGameInfoLength > 1000) {
    modulo = 100;
  } else if (basicGameInfoLength > 500) {
    modulo = 50;
  } else if (basicGameInfoLength > 100) {
    modulo = 20;
  }

  if (iterationIndexFromOne % modulo === 0 || iterationIndexFromOne === basicGameInfoLength) {
    logger.info(
      `progress: processing game %d of %d (%d)\%`,
      iterationIndexFromOne,
      basicGameInfoLength,
      Math.round((iterationIndexFromOne / basicGameInfoLength) * 100),
    );
  }
}

async function lookupSteamGame(appId: number, language: string, logger: Logger) {
  const steamStoreApiUrl = new URL(`${STEAM_STORE_API_ENDPOINT}/${STEAM_STORE_API_APP_DETAILS_METHOD}/`);

  steamStoreApiUrl.searchParams.append("appids", appId.toString());
  steamStoreApiUrl.searchParams.append("l", language);

  const steamStoreApiUrlString = steamStoreApiUrl.href;

  logger.debug("fetching Steam Store data from URL: %s", steamStoreApiUrlString);

  try {
    const result = await fetch(steamStoreApiUrlString);
    if (result.status === 429) {
      logger.error("rate limited by Steam Store API");

      return;
    }

    return await result.json();
  } catch (_err) {
    logger.error(`failed to fetch app ID %d and not rate limited`, appId);
  }
}

function mapSteamAppToProcessedGameInfo(data: any, logger: Logger): ProcessedSteamGameInfo | undefined {
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
    logger.error(`failed to process app ID %d: %s`, data.appId, err);
  }
}
