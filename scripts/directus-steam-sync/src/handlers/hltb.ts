import { Logger } from "pino";
import { HowLongToBeatService } from "howlongtobeat";
import sleep from "../utils/sleep";
import { ProcessedSteamGameInfo } from "./steam/types";
import { logProgress } from "../utils/logger";

const HLTB_API_SLEEP_MS = 1000;

const FetchHLTBDataDefaultOptions: FetchHLTBDataOptions = {
  useCache: true,
};

interface FetchHLTBDataOptions {
  useCache?: boolean;
}

// FIXME: This is currently completely broken. HLTB values will not come through. Should rewrite using direct HTTPS.

export async function processHltbDataForSteamGames(
  gameInfos: ProcessedSteamGameInfo[],
  options = FetchHLTBDataDefaultOptions,
  logger: Logger,
) {
  logger.info("fetching HLTB data for %d games...", gameInfos.length);

  const finalOptions: FetchHLTBDataOptions = { ...FetchHLTBDataDefaultOptions, ...options };

  const hltbService = new HowLongToBeatService();

  for (const gameInfo of gameInfos) {
    logProgress(gameInfos.indexOf(gameInfo) + 1, gameInfos.length, "HLTB info", logger);

    logger.debug("querying HLTB for game: %s", gameInfo.name);

    if (gameInfo.last_hltb_update_timestamp && finalOptions.useCache) {
      logger.debug("skipping HLTB fetch for %s as data already exists", gameInfo.name);

      continue;
    }

    await sleep(HLTB_API_SLEEP_MS);

    try {
      const result = await hltbService.search(gameInfo.name);
      if (result && result.length > 0) {
        const hltbData = result[0];

        logger.debug(
          "fetched HLTB data for %s: main=%d, main+extras=%d, completionist=%d",
          hltbData.searchTerm,
          hltbData.gameplayMain,
          hltbData.gameplayMainExtra,
          hltbData.gameplayCompletionist,
        );

        gameInfo.hltb_name = hltbData.name;
        gameInfo.hltb_hours = hltbData.gameplayMain;
        gameInfo.hltb_hours_extra = hltbData.gameplayMainExtra;
        gameInfo.hltb_hours_completionist = hltbData.gameplayCompletionist;
        gameInfo.hltb_url = `https://howlongtobeat.com/game/${hltbData.id}`;
      }

      gameInfo.last_hltb_update_timestamp = new Date().getTime();
    } catch (err) {
      logger.error("failed to fetch HLTB data for %s: %s", gameInfo.name, err);
    }
  }

  logger.info("completed fetching HLTB data");

  return gameInfos;
}

export async function processHltbDataForSteamGamesUsingAlternateSource(
  gameInfos: ProcessedSteamGameInfo[],
  options = FetchHLTBDataDefaultOptions,
  logger: Logger,
) {
  logger.info("fetching HLTB data for %d games...", gameInfos.length);

  const finalOptions: FetchHLTBDataOptions = { ...FetchHLTBDataDefaultOptions, ...options };

  for (const gameInfo of gameInfos) {
    logProgress(gameInfos.indexOf(gameInfo) + 1, gameInfos.length, "HLTB info", logger);

    logger.debug("querying HLTB for game: %s", gameInfo.name);

    if (gameInfo.last_hltb_update_timestamp && finalOptions.useCache) {
      logger.debug("skipping HLTB fetch for %s as data already exists", gameInfo.name);

      continue;
    }

    await sleep(HLTB_API_SLEEP_MS);

    try {
      const result = await callTemporaryHltbApi(gameInfo.appId);
      if (result) {
        logger.debug(
          "fetched HLTB data for appId %s: name=%s main=%d, main+extras=%d, completionist=%d",
          gameInfo.appId,
          result.title,
          result.mainStory,
          result.mainStoryWithExtras,
          result.completionist,
        );

        gameInfo.hltb_name = result.title;
        gameInfo.hltb_hours = result.mainStory;
        gameInfo.hltb_hours_extra = result.mainStoryWithExtras;
        gameInfo.hltb_hours_completionist = result.completionist;
        gameInfo.hltb_url = `https://howlongtobeat.com/game/${result.id}`;
      }

      gameInfo.last_hltb_update_timestamp = new Date().getTime();
    } catch (err) {
      logger.error("failed to fetch HLTB data for %s: %s", gameInfo.name, err);
    }
  }

  logger.info("completed fetching HLTB data");

  return gameInfos;
}

async function callTemporaryHltbApi(steamAppId: number) {
  // curl https://hltbapi1.azurewebsites.net/steam/<appId>

  const response = await fetch(`https://hltbapi1.azurewebsites.net/steam/${steamAppId}`);

  if (response.status !== 200) {
    throw new Error(`HLTB API returned status ${response.status}`);
  }

  const body = await response.json();

  if (!body.id) {
    throw new Error(`HLTB API returned no data for Steam App ID ${steamAppId}`);
  }

  return body;
}
