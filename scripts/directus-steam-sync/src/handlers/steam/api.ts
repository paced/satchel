import { Logger } from "pino";
import { config } from "dotenv";
import { updateOwnedGamesCache } from "./caches";

const { parsed } = config({ quiet: true });

const STEAM_API_KEY = parsed?.STEAM_API_KEY || "";

const STEAM_API_ENDPOINT = "https://api.steampowered.com";
const STEAM_STORE_API_ENDPOINT = "https://store.steampowered.com/api";

const STEAM_API_GET_OWNED_GAMES_METHOD = "IPlayerService/GetOwnedGames/v0001";
const STEAM_STORE_API_APP_DETAILS_METHOD = "appdetails";

export async function fetchOwnedGames(targetSteamId: string, logger: Logger) {
  logger.info("---------");
  logger.info("DETERMINING USER'S STEAM GAMES");
  logger.info("---------");

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

  await updateOwnedGamesCache(targetSteamId, appIds, logger);

  return appIds;
}

export function createLookupUrl(appId: number, language: string) {
  const steamStoreApiUrl = new URL(`${STEAM_STORE_API_ENDPOINT}/${STEAM_STORE_API_APP_DETAILS_METHOD}/`);

  steamStoreApiUrl.searchParams.append("appids", appId.toString());
  steamStoreApiUrl.searchParams.append("l", language);

  return steamStoreApiUrl.toString();
}

export async function lookupSteamGame(steamStoreApiUrlString: string) {
  const result = await fetch(steamStoreApiUrlString);
  if (result.status === 429) {
    throw new Error("rate limited by Steam Store API");
  }

  return await result.json();
}
