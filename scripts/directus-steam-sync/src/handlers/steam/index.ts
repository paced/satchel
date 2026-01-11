import {
  loadGameInfoCache,
  loadKnownDeletedGamesCache,
  updateKnownDeletedGamesCache,
  updateSteamGameInfoCache,
} from "./caches";
import { Logger } from "pino";
import { createLookupUrl, fetchOwnedGames, lookupSteamGame } from "./api";
import { BasicSteamGameInfo, ProcessedSteamGameInfo } from "./types";
import { mapSteamAppToProcessedGameInfo } from "./mappers";
import { logProgress } from "../../utils/logger";

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

const DEFAULT_LANGUAGE = "english";
const DEFAULT_PROCESS_GAME_OPTIONS: ProcessGamesOptions = {
  debug: false,
  language: DEFAULT_LANGUAGE,
  useCache: true,
};

interface ProcessGamesOptions {
  debug?: boolean;
  language?: string;

  /**
   * Whether to use the existing game info cache to avoid re-fetching data from the Steam Store API.
   */
  useCache?: boolean;
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
  const basicSteamGameInfos: BasicSteamGameInfo[] = await fetchOwnedGames(targetSteamId, logger);

  logger.info("---------");
  logger.info("FINDING DETAILS ABOUT OWNED STEAM GAMES");
  logger.info("---------");

  const cachedGameInfos: ProcessedSteamGameInfo[] = options.useCache ? await loadGameInfoCache(logger) : [];
  const knownDeletedAppIds: number[] = options.useCache ? await loadKnownDeletedGamesCache(logger) : [];

  const gameInfos: ProcessedSteamGameInfo[] = [];
  const failedGameInfos: number[] = [];

  logger.info("beginning processing of %d owned Steam games...", basicSteamGameInfos.length);

  for (const basicGameInfo of basicSteamGameInfos) {
    logProgress(basicSteamGameInfos.indexOf(basicGameInfo) + 1, basicSteamGameInfos.length, "game", logger);

    const existingGameIndex = gameInfos.findIndex((gi) => gi.appId === basicGameInfo.appId);
    if (existingGameIndex !== -1) {
      logger.debug("duplicate app ID %d found, skipping duplicate", basicGameInfo.appId);

      continue;
    }

    const cachedGameInfo = cachedGameInfos.find((cached) => cached.appId === basicGameInfo.appId);
    if (cachedGameInfo) {
      logger.debug("using cached data for app ID %d", basicGameInfo.appId);
      gameInfos.push({
        ...cachedGameInfo,
        basicData: basicGameInfo,
      });

      continue;
    }

    if (knownDeletedAppIds.includes(basicGameInfo.appId)) {
      logger.debug("skipping known deleted app ID %d", basicGameInfo.appId);
      failedGameInfos.push(basicGameInfo.appId);

      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, STEAM_STORE_API_SLEEP_MS));

    const lookupUrl = createLookupUrl(basicGameInfo.appId, options.language || DEFAULT_LANGUAGE);
    const appData = await lookupSteamGame(lookupUrl).catch((err) => {
      logger.error("HTTP fetch failed for app ID %d: %s", basicGameInfo.appId, err);

      return;
    });

    if (!appData || !appData[basicGameInfo.appId]) {
      continue;
    }

    if (!appData[basicGameInfo.appId].success) {
      logger.warn("fetch succeeded but success is false for app ID %d", basicGameInfo.appId);
      failedGameInfos.push(basicGameInfo.appId);

      if (appData[basicGameInfo.appId] && appData[basicGameInfo.appId].success === false) {
        knownDeletedAppIds.push(basicGameInfo.appId);
      }

      continue;
    }

    const parsedGameInfo = mapSteamAppToProcessedGameInfo(
      basicGameInfo,
      appData[basicGameInfo.appId].data,
      lookupUrl,
      logger,
    );
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
    await updateSteamGameInfoCache(cachedGameInfos, gameInfos, logger);
    await updateKnownDeletedGamesCache(knownDeletedAppIds, logger);
  }

  return gameInfos;
}
