import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Logger } from "pino";
import type { BasicSteamGameInfo, ProcessedSteamGameInfo } from "./types";

const GAME_INFO_CACHE_PATH = "out/steam-game-info-cache.json";
const GAME_OWNED_CACHE_PATH = "out/steam-owned-games-cache-%d.json";
const GAME_KNOWN_DELETED_CACHE_PATH = "out/steam-known-deleted-games-cache.json";

export async function loadGameInfoCache(logger: Logger): Promise<ProcessedSteamGameInfo[]> {
  let cachedGameInfos: ProcessedSteamGameInfo[] = [];

  try {
    const cacheData = await readFile(GAME_INFO_CACHE_PATH, "utf-8");
    cachedGameInfos = JSON.parse(cacheData);

    logger.info("loaded %d Steam games from cache", cachedGameInfos.length);
  } catch (err) {
    logger.info("no cache file found, will create new cache");

    cachedGameInfos = [];
  }

  return cachedGameInfos;
}

export async function updateSteamGameInfoCache(
  existingGameInfos: ProcessedSteamGameInfo[],
  gameInfos: ProcessedSteamGameInfo[],
  logger: Logger,
): Promise<void> {
  try {
    const combinedGameInfos = [...existingGameInfos, ...gameInfos];

    const uniqueGameInfosMap: Record<number, ProcessedSteamGameInfo> = {};
    combinedGameInfos.forEach((gameInfo) => {
      uniqueGameInfosMap[gameInfo.appId] = gameInfo;
    });

    const uniqueGameInfos = Object.values(uniqueGameInfosMap).sort((a, b) => a.appId - b.appId);
    const gameInfosWithoutPersonalization = uniqueGameInfos.map((gameInfo) => {
      const { basicData, ...rest } = gameInfo;

      return rest;
    });

    await mkdir("out", { recursive: true });
    await writeFile(GAME_INFO_CACHE_PATH, JSON.stringify(gameInfosWithoutPersonalization, null, 2), "utf-8");

    logger.info("wrote %d games to cache", gameInfosWithoutPersonalization.length);
  } catch (err) {
    logger.error("failed to write cache file: %s", err);
  }
}

export async function loadOwnedGamesCache(targetSteamId: string, logger: Logger): Promise<number[]> {
  let cachedAppIds: number[] = [];

  try {
    const cacheFilename = GAME_OWNED_CACHE_PATH.replace("%d", targetSteamId);
    const cacheData = await readFile(cacheFilename, "utf-8");

    cachedAppIds = JSON.parse(cacheData);

    logger.info("loaded %d owned Steam app IDs from cache", cachedAppIds.length);
  } catch (err) {
    logger.info("no owned games cache file found, will create new cache");

    cachedAppIds = [];
  }

  return cachedAppIds;
}

export async function updateOwnedGamesCache(
  targetSteamId: string,
  basicSteamGameInfos: BasicSteamGameInfo[],
  logger: Logger,
): Promise<void> {
  try {
    const cacheFilename = GAME_OWNED_CACHE_PATH.replace("%d", targetSteamId);

    const sortedAppIds = basicSteamGameInfos.sort((a, b) => a.appId - b.appId);

    await mkdir("out", { recursive: true });
    await writeFile(cacheFilename, JSON.stringify(sortedAppIds, null, 2), "utf-8");

    logger.info("wrote %d owned app IDs to owned game cache", sortedAppIds.length);
  } catch (err) {
    logger.error("failed to write owned games cache file: %s", err);
  }
}

export async function loadKnownDeletedGamesCache(logger: Logger): Promise<number[]> {
  let knownDeletedAppIds: number[] = [];
  try {
    const cacheData = await readFile(GAME_KNOWN_DELETED_CACHE_PATH, "utf-8");

    knownDeletedAppIds = JSON.parse(cacheData);

    logger.info("loaded %d known deleted Steam app IDs from cache", knownDeletedAppIds.length);
  } catch (err) {
    logger.info("no known deleted games cache file found, will create new cache");

    knownDeletedAppIds = [];
  }

  return knownDeletedAppIds;
}

export async function updateKnownDeletedGamesCache(appIds: number[], logger: Logger): Promise<void> {
  try {
    const sortedAppIds = appIds.sort((a, b) => a - b);

    await mkdir("out", { recursive: true });
    await writeFile(GAME_KNOWN_DELETED_CACHE_PATH, JSON.stringify(sortedAppIds, null, 2), "utf-8");

    logger.info("wrote %d known deleted app IDs to cache", sortedAppIds.length);
  } catch (err) {
    logger.error("failed to write known deleted games cache file: %s", err);
  }
}
