import {
  loadGameInfoCache,
  loadKnownDeletedGamesCache,
  updateKnownDeletedGamesCache,
  updateSteamGameInfoCache,
} from "./caches";
import { Logger } from "pino";
import { createSteamGameLookupUrl, fetchOwnedGames, lookupSteamGame, lookupSteamReview } from "./api";
import { BasicSteamGameInfo, ProcessedSteamGameInfo } from "./types";
import { mapSteamAppToProcessedGameInfo } from "./mappers";
import { logProgress } from "../../utils/logger";
import sleep from "../../utils/sleep";
// import { processHltbDataForSteamGames } from "../hltb";

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
const STEAM_REVIEWS_API_SLEEP_MS = 3000;

const DEFAULT_LANGUAGE = "english";
const DEFAULT_PROCESS_GAME_OPTIONS: ProcessGamesOptions = {
  debug: false,
  language: DEFAULT_LANGUAGE,
  useCache: true,
};

/**
 * Number of days to wait before rechecking reviews for games already in the cache.
 *
 * ## Notes
 *
 * 6 months is a reasonable default, as reviews do not change frequently for most games. However, with the amount of
 * Early Access, live-service, and frequently updated games on Steam, it cannot be increased too much, e.g., games such
 * as Apex Legends, Cyberpunk 2077, No Man's Sky, Infinity Nikki, and many others have seen significant review changes
 * over time.
 */
const DEFAULT_DAYS_TO_RECHECK_REVIEWS_IF_CACHED = 30 * 6;

interface ProcessGamesOptions {
  debug?: boolean;
  language?: string;

  /**
   * Whether to use the existing game info cache to avoid re-fetching data from the Steam Store API.
   */
  useCache?: boolean;

  daysToRecheckReviewsIfCached?: number;
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
    // Overwrite only if the overwriter is the admin user.

    if (uniqueGamesMap[game.appId]?.basicData?.isAdmin && !game.basicData?.isAdmin) {
      logger.debug(
        "skipping non-admin duplicate app ID %d (%s) with %d hours played in favor of %d hours played",
        game.appId,
        game.name,
        game.basicData?.hours || 0,
        uniqueGamesMap[game.appId].basicData?.hours || 0,
      );

      return;
    }

    uniqueGamesMap[game.appId] = game;
  });

  const uniqueGames = Object.values(uniqueGamesMap).sort((a, b) => a.appId - b.appId);

  logger.info("total unique Steam games processed across all users: %d", uniqueGames.length);

  return uniqueGames;
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

    logger.debug("processing Steam App ID %d...", basicGameInfo.appId);

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

    await sleep(STEAM_STORE_API_SLEEP_MS);

    const lookupUrl = createSteamGameLookupUrl(basicGameInfo.appId, options.language || DEFAULT_LANGUAGE);
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

  await updateSteamGameInfoCache(cachedGameInfos, gameInfos, logger);
  await updateKnownDeletedGamesCache(knownDeletedAppIds, logger);

  await processSteamGameReviews(gameInfos, options, logger);
  await updateSteamGameInfoCache(cachedGameInfos, gameInfos, logger);

  // FIXME: These are borked.

  // await processHltbDataForSteamGames(gameInfos, options, logger);
  // await updateSteamGameInfoCache(cachedGameInfos, gameInfos, logger);

  return gameInfos;
}

async function processSteamGameReviews(
  gameInfos: ProcessedSteamGameInfo[],
  options: ProcessGamesOptions,
  logger: Logger,
): Promise<ProcessedSteamGameInfo[]> {
  logger.info("processing Steam reviews for %d games...", gameInfos.length);

  for (const gameInfo of gameInfos) {
    logProgress(gameInfos.indexOf(gameInfo) + 1, gameInfos.length, "review", logger);

    logger.debug("processing reviews for Steam App ID %d (%s)...", gameInfo.appId, gameInfo.name);

    const now = Date.now();
    const reviewCacheAgeMs =
      (options.daysToRecheckReviewsIfCached || DEFAULT_DAYS_TO_RECHECK_REVIEWS_IF_CACHED) * 24 * 60 * 60 * 1000;
    if (gameInfo.total_reviews !== undefined && options.useCache && gameInfo.last_review_update_timestamp) {
      const reviewLastCheckedAgeMs = now - gameInfo.last_review_update_timestamp;
      if (reviewLastCheckedAgeMs < reviewCacheAgeMs) {
        logger.debug(
          "reviews for app ID %d checked %d days ago, within recheck period of %d days, skipping",
          gameInfo.appId,
          Math.floor(reviewLastCheckedAgeMs / (1000 * 60 * 60 * 24)),
          options.daysToRecheckReviewsIfCached || DEFAULT_DAYS_TO_RECHECK_REVIEWS_IF_CACHED,
        );

        continue;
      }
    }

    await sleep(STEAM_REVIEWS_API_SLEEP_MS);

    const result = await lookupSteamReview(gameInfo.appId, options.language || DEFAULT_LANGUAGE).catch((err) => {
      logger.error("HTTP fetch failed for reviews for app ID %d: %s", gameInfo.appId, err);

      return;
    });

    if (!result || !result[gameInfo.appId]) {
      continue;
    }

    if (result.success !== 1 || !result.success) {
      logger.warn("fetch succeeded but success is false for reviews for app ID %d", gameInfo.appId);

      continue;
    }

    const total_reviews = result.query_summary.total_reviews;
    const total_positive = result.query_summary.total_positive;
    const total_negative = result.query_summary.total_negative;
    const review_score_desc = result.query_summary.review_score_desc;

    gameInfo.total_reviews = total_reviews;
    gameInfo.total_positive_reviews = total_positive;
    gameInfo.total_negative_reviews = total_negative;
    gameInfo.review_category = review_score_desc;
  }

  return gameInfos;
}
