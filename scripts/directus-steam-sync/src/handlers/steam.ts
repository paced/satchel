import { readFile, writeFile, mkdir } from "node:fs/promises";

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

const GAME_INFO_CACHE_PATH = "out/game-info-cache.json";

interface BasicGameInfo {
  appId: number;
  playtime: number;
}

interface ProcessedGameInfo {
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
  useCache: boolean;
}

/**
 * Fetches and "processes" the games owned by a Steam user, most likely the user associated with the API key.
 *
 * ## How this works
 *
 * 1. Calls the Steam Web API to get the list of the owned games for a user. This is a fast endpoint and is likely to
 *    changed frequently for those who feel the need to use this script, so this is not cached.
 * 2. Each game is processed by calling the Steam API for each game. This information changes infrequently so this is
 *    cached by default in the {@link GAME_INFO_CACHE_PATH} file. Cache misses will target the Steam API with a delay to
 *    avoid rate limits.
 * 3. Finally, the games are saved to out/processed-games-<date>.json to speed up the Directus import part later, or
 *    any other script that may want to use this data. However, when running the entire script, the return of this
 *    function is used directly to import into Directus without more file I/O.
 *
 * @param apiKey {string} the Steam Web API key
 * @param targetSteamId {string} the target Steam ID with the library to process
 * @param options {ProcessGamesOptions} options for processing games
 * @returns {Promise<ProcessedGameInfo[]>} the processed game information
 */
export async function processGames(
  apiKey: string,
  targetSteamId: string,
  options: ProcessGamesOptions = { useCache: true },
): Promise<ProcessedGameInfo[]> {
  const steamApiUrl = new URL(`${STEAM_API_ENDPOINT}/${STEAM_API_GET_OWNED_GAMES_METHOD}/`);

  steamApiUrl.searchParams.append("key", apiKey);
  steamApiUrl.searchParams.append("steamid", targetSteamId);
  steamApiUrl.searchParams.append("format", "json");

  const steamApiUrlString = steamApiUrl.href;

  console.log("[info] fetching Steam data from URL", steamApiUrlString);

  const result = await fetch(steamApiUrlString);

  const data = await result.json();

  const gameCount = data.response.game_count;
  const games = data.response.games;

  console.log(`[info] user owns ${gameCount} games, processing...`);

  const basicGameInfos: BasicGameInfo[] = [];
  games.forEach((game: any) => {
    const appId = game.appid;
    const playtime = game.playtime_forever;

    basicGameInfos.push({ appId, playtime });
  });

  const cachedGameInfos: ProcessedGameInfo[] = options.useCache ? await loadCache() : [];
  const gameInfos: ProcessedGameInfo[] = [];
  const failedGameInfos: BasicGameInfo[] = [];

  for (const gameInfo of basicGameInfos) {
    const iterationIndexFromOne = basicGameInfos.indexOf(gameInfo) + 1;

    let modulo = 10;
    if (basicGameInfos.length > 1000) {
      modulo = 100;
    } else if (basicGameInfos.length > 500) {
      modulo = 50;
    } else if (basicGameInfos.length > 100) {
      modulo = 20;
    }

    if (iterationIndexFromOne % modulo === 0 || iterationIndexFromOne === basicGameInfos.length) {
      console.log(
        `[info] processing game ${iterationIndexFromOne} of ${basicGameInfos.length} (app ID: ${gameInfo.appId})`,
      );
    }

    const existingGameIndex = gameInfos.findIndex((gi) => gi.appId === gameInfo.appId);
    if (existingGameIndex !== -1) {
      console.debug(`[debug] duplicate app ID ${gameInfo.appId} found, skipping duplicate`);

      continue;
    }

    const cachedGameInfo = cachedGameInfos.find((cached) => cached.appId === gameInfo.appId);
    if (cachedGameInfo) {
      console.debug(`[debug] using cached data for app ID ${gameInfo.appId}`);

      gameInfos.push(cachedGameInfo);

      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, STEAM_STORE_API_SLEEP_MS));

    const appData = await lookupApp(gameInfo.appId);
    if (!appData || !appData[gameInfo.appId] || !appData[gameInfo.appId].success) {
      console.warn(`[warn] failure for app ID ${gameInfo.appId}, it may have been removed from Steam! Skipping...`);

      failedGameInfos.push(gameInfo);

      continue;
    }

    const data = appData[gameInfo.appId].data;

    try {
      const processedGameInfo: ProcessedGameInfo = {
        appId: gameInfo.appId,
        name: data.name,

        detailed_description: data.detailed_description,
        about_the_game: data.about_the_game,
        short_description: data.short_description,

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

        categories: data.categories ? data.categories.map((category: any) => category.description) : [],
        genres: data.genres ? data.genres.map((genre: any) => genre.description) : [],
      };

      gameInfos.push(processedGameInfo);
    } catch (err) {
      console.error(`[error] failed to process app ID ${gameInfo.appId}:`, err);
    }
  }

  if (options.useCache) {
    await updateCache(gameInfos);
  }

  if (failedGameInfos.length > 0) {
    console.error(
      `[info] failed to process ${failedGameInfos.length} games:`,
      failedGameInfos.map((basicGameInfo) => basicGameInfo.appId),
    );
  }

  return gameInfos;
}

async function loadCache(): Promise<ProcessedGameInfo[]> {
  let cachedGameInfos: ProcessedGameInfo[] = [];

  try {
    const cacheData = await readFile(GAME_INFO_CACHE_PATH, "utf-8");
    cachedGameInfos = JSON.parse(cacheData);

    console.log(`[info] loaded ${cachedGameInfos.length} games from cache`);
  } catch (err) {
    console.log("[info] no cache file found, will create new cache");

    cachedGameInfos = [];
  }

  return cachedGameInfos;
}

async function updateCache(gameInfos: ProcessedGameInfo[]): Promise<void> {
  try {
    const sortedGameInfos = gameInfos.sort((a, b) => a.appId - b.appId);

    await mkdir("out", { recursive: true });
    await writeFile(GAME_INFO_CACHE_PATH, JSON.stringify(sortedGameInfos, null, 2), "utf-8");

    console.log(`[info] wrote ${gameInfos.length} games to cache`);
  } catch (err) {
    console.error("[error] failed to write cache file:", err);
  }
}

async function lookupApp(appId: number) {
  const steamStoreApiUrl = new URL(`${STEAM_STORE_API_ENDPOINT}/${STEAM_STORE_API_APP_DETAILS_METHOD}/`);

  steamStoreApiUrl.searchParams.append("appids", appId.toString());

  const steamStoreApiUrlString = steamStoreApiUrl.href;

  console.debug("[debug] fetching Steam Store data from URL", steamStoreApiUrlString);

  try {
    const result = await fetch(steamStoreApiUrlString);
    if (result.status === 429) {
      console.error("[error] rate limited by Steam Store API");

      return;
    }

    return await result.json();
  } catch (_err) {
    console.error(`[error] failed to fetch app ID ${appId} and not rate limited`);
  }
}
