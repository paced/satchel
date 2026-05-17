import { Logger } from "pino";
import sleep from "../utils/sleep";
import { ProcessedSteamGameInfo } from "./steam/types";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { logProgress } from "../utils/logger";
import { loadDissimilarGamesCache, updateDissimilarGamesCache } from "./steam/caches";

const FetchHLTBDataDefaultOptions: FetchHLTBDataOptions = {
  useCache: true,
};

interface FetchHLTBDataOptions {
  useCache?: boolean;
}

const MAX_HLTB_FAILED_ATTEMPTS = 10;
const HLTB_API_SLEEP_MS_BASE = 1500;

export async function processHltbDataForSteamGames(
  gameInfos: ProcessedSteamGameInfo[],
  options = FetchHLTBDataDefaultOptions,
  logger: Logger,
) {
  const finalOptions: FetchHLTBDataOptions = { ...FetchHLTBDataDefaultOptions, ...options };

  logger.info("---------");
  logger.info("FETCHING HOW LONG TO BEAT DATA");
  logger.info("---------");

  logger.info("fetching HLTB data for %d games...", gameInfos.length);
  logger.info("capturing HLTB auth token...");

  let authToken: string;
  try {
    authToken = await captureHltbAuthToken();
  } catch (err) {
    logger.error("failed to capture HLTB auth token: %s, aborting HLTB data fetch", err);

    return gameInfos;
  }

  logger.debug("captured HLTB auth token: %s", authToken);

  const dissimilarGamesCache = await loadDissimilarGamesCache("dissimilar", logger);
  const unconfidentGamesCache = await loadDissimilarGamesCache("unconfident", logger);

  // Merge the two caches together since they both tell us if a game matches or not.

  const appIdToPossibleNamesMap: Record<
    number,
    { gameInfoName: string; matchedName: string; status: "yes" | "no" | "unconfirmed" }
  > = {};
  for (const [appIdStr, entry] of Object.entries(dissimilarGamesCache)) {
    const appId = parseInt(appIdStr, 10);

    appIdToPossibleNamesMap[appId] = entry;
  }
  for (const [appIdStr, entry] of Object.entries(unconfidentGamesCache)) {
    const appId = parseInt(appIdStr, 10);

    appIdToPossibleNamesMap[appId] = entry;
  }

  const dissimilarNameWarnings: { appId: number; gameInfoName: string; matchedName: string }[] = [];
  const nonConfidentMatchWarnings: { appId: number; gameInfoName: string; matchedName: string }[] = [];

  let failedAttempts = 0;

  for (const gameInfo of gameInfos) {
    logProgress(gameInfos.indexOf(gameInfo) + 1, gameInfos.length, "HLTB lookup", logger);

    const similarityEntry = appIdToPossibleNamesMap[gameInfo.appId];
    const hasCachedSimilarityEntry = similarityEntry && similarityEntry.status === "yes";

    const sanitizedGameInfoName = sanitizeGameName(gameInfo.name);
    const sanitizedHltbName = sanitizeGameName(gameInfo.hltb_name || "");

    const appNameMatchesHltbName = sanitizedGameInfoName === sanitizedHltbName;
    const appNameContainsHltbName = sanitizedGameInfoName.includes(sanitizedHltbName);
    const hltbNameContainsAppName = sanitizedHltbName.includes(sanitizedGameInfoName);

    const namesAreSimilar = appNameMatchesHltbName || appNameContainsHltbName || hltbNameContainsAppName;

    if (
      hasCachedSimilarityEntry &&
      similarityEntry.gameInfoName === gameInfo.name &&
      similarityEntry.matchedName === gameInfo.hltb_name
    ) {
      // Known dissimilar name but same game, so no need to warn or re-run HLTB fetch.
    } else if (gameInfo.hltb_name && !namesAreSimilar) {
      logger.warn(
        "detected dissimilar name for App ID %d: %s (%s) vs %s (%s)",
        gameInfo.appId,
        gameInfo.name,
        sanitizedGameInfoName,
        gameInfo.hltb_name,
        sanitizedHltbName,
      );
      dissimilarNameWarnings.push({
        appId: gameInfo.appId,
        gameInfoName: gameInfo.name,
        matchedName: gameInfo.hltb_name,
      });
    } else if (gameInfo.hltb_name && !appNameMatchesHltbName) {
      logger.warn(
        "detected non-confident name match for App ID %d: %s (%s) vs %s (%s)",
        gameInfo.appId,
        gameInfo.name,
        sanitizedGameInfoName,
        gameInfo.hltb_name,
        sanitizedHltbName,
      );
      nonConfidentMatchWarnings.push({
        appId: gameInfo.appId,
        gameInfoName: gameInfo.name,
        matchedName: gameInfo.hltb_name,
      });
    }

    const isExplicitlyDissimilar =
      similarityEntry &&
      similarityEntry.status === "no" &&
      similarityEntry.gameInfoName === gameInfo.name &&
      similarityEntry.matchedName === gameInfo.hltb_name;

    if (isExplicitlyDissimilar) {
      logger.warn("going ahead with HLTB fetch for %s because of explicit dissimilarity", gameInfo.name);
    } else if (gameInfo.last_hltb_update_timestamp && finalOptions.useCache) {
      logger.debug("skipping HLTB fetch for %s as data already exists", gameInfo.name);

      continue;
    }

    await sleep(HLTB_API_SLEEP_MS_BASE + failedAttempts * 1000);

    try {
      const searchQuery = gameInfo.name.replaceAll("™", "").replaceAll("®", "");

      const response = await makeHtlbSearchRequest(searchQuery, authToken);
      const result = response.data;

      if (result && result.length > 0) {
        const hltbData = result[0];

        logger.info(
          "fetched new HLTB data for %s: main=%d, main+extras=%d, completionist=%d",
          hltbData.game_name,
          Math.round(hltbData.comp_main / 60 / 60),
          Math.round(hltbData.comp_plus / 60 / 60),
          Math.round(hltbData.comp_100 / 60 / 60),
        );

        gameInfo.hltb_name = hltbData.game_name;
        gameInfo.hltb_hours = Math.round(hltbData.comp_main / 60 / 60);
        gameInfo.hltb_hours_extra = Math.round(hltbData.comp_plus / 60 / 60);
        gameInfo.hltb_hours_completionist = Math.round(hltbData.comp_100 / 60 / 60);
        gameInfo.hltb_url = `https://howlongtobeat.com/game/${hltbData.game_id}`;
      } else {
        logger.debug("no HLTB data found for %s but request succeeded", gameInfo.name);
      }

      gameInfo.last_hltb_update_timestamp = new Date().getTime();

      failedAttempts = 0;
    } catch (err) {
      logger.error("failed to fetch HLTB data for %s: %s", gameInfo.name, err);

      failedAttempts++;

      if (failedAttempts >= MAX_HLTB_FAILED_ATTEMPTS) {
        logger.error("maximum HLTB failed attempts reached; aborting HLTB data fetch");

        break;
      }

      logger.warn(
        "will retry HLTB data fetch for %s after re-capturing auth token (failed attempts: %d)",
        gameInfo.name,
        failedAttempts,
      );

      try {
        logger.debug("waiting 5 seconds before recapturing HLTB auth token...");

        await sleep(5000);

        authToken = await captureHltbAuthToken();

        logger.debug("recaptured HLTB auth token: %s", authToken);
      } catch (err) {
        logger.error("failed to recapture HLTB auth token: %s, aborting...", err);

        break;
      }
    }
  }

  logger.info("completed fetching HLTB data");

  await updateDissimilarGamesCache("dissimilar", dissimilarGamesCache, dissimilarNameWarnings, logger);
  await updateDissimilarGamesCache("unconfident", unconfidentGamesCache, nonConfidentMatchWarnings, logger);

  return gameInfos;
}

chromium.use(stealth());

async function captureHltbAuthToken(): Promise<string> {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "Australia/Melbourne",
  });
  const page = await context.newPage();

  try {
    return await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`timeout: auth header not found`));
      }, 30000);

      page.on("request", (request) => {
        if (request.resourceType() === "xhr" || request.resourceType() === "fetch") {
          if (request.url().includes("/api/search") && request.method() === "POST") {
            const headers = request.headers();
            const value = headers["x-auth-token"];
            if (value) {
              clearTimeout(timeoutId);
              resolve(value);
            }
          }
        }
      });

      page.goto("https://howlongtobeat.com/?q=test").catch(reject);
    });
  } finally {
    await browser.close();
  }
}

async function makeHtlbSearchRequest(query: string, authToken: string): Promise<any> {
  // Needs to still be done with the browser.

  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:146.0) Gecko/20100101 Firefox/146.0",
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "Australia/Melbourne",
  });
  const page = await context.newPage();

  // TODO: This probably doesn't need to be done in a browser context, but I struggled to get this working before. Once
  //       the query count is lower, I should try doing this with a normal fetch.

  try {
    const response = await page.request.post("https://howlongtobeat.com/api/search", {
      headers: {
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Alt-Used": "https://howlongtobeat.com/",
        Origin: "https://howlongtobeat.com",
        "Content-Type": "application/json",
        "x-auth-token": authToken,
        Cookie:
          "OptanonConsent=isGpcEnabled=1&datestamp=Mon+Jan+12+2026+13%3A40%3A34+GMT%2B1100+(Australian+Eastern+Daylight+Time)&version=202509.1.0&browserGpcFlag=1&isIABGlobal=false&genVendors=&consentId=428fff79-d5c6-4836-83e3-2c68d9fba7bc&interactionCount=0&isAnonUser=1&landingPath=NotLandingPage&GPPCookiesCount=1&gppSid=7&groups=C0001%3A1%2CC0002%3A1%2COSSTA_BG%3A0%2CC0004%3A0&AwaitingReconsent=false; OTGPPConsent=DBABLA~BVQVAAAAAAGA.YA; usprivacy=1YYY; opt_out=1",
        Host: "howlongtobeat.com",
        Referer: "https://howlongtobeat.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        TE: "trailers",
      },
      data: {
        searchType: "games",
        searchTerms: [query],
        searchPage: 1,
        size: 20,
        searchOptions: {
          games: {
            userId: 0,
            platform: "",
            sortCategory: "popular",
            rangeCategory: "main",
            rangeTime: { min: null, max: null },
            gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
            rangeYear: { min: "", max: "" },
            modifier: "hide_dlc",
          },
          users: { sortCategory: "postcount" },
          lists: { sortCategory: "follows" },
          filter: "",
          sort: 0,
          randomizer: 0,
        },
        useCache: true,
      },
    });

    return await response.json();
  } finally {
    await browser.close();
  }
}

// Note: shorter names that contain longer ones should be below the longer ones.

const GAME_NAME_STRINGS_TO_IGNORE = [
  "Game of the Year Edition",
  "Game of the Year",
  "GOTY Edition",
  "GOTY",
  "Definitive Edition",
  "Complete Edition",
  "Ultimate Edition",
  "Legendary Edition",
  "Anniversary Edition",
  "Deluxe Edition",
  "Deluxe",
  "Collector's Edition",
  "Enhanced Edition",
  "Enhanced",
  "Remastered Edition",
  "Remastered",
  "Remaster",
  "Special Edition",
  "Limited Edition",
  "Standard Edition",
  "HD Edition",
  "HD",
  "Directors Cut",
  "Gold Edition",
  "Sid Meiers",
  "Shin Megami Tensei",
  "Farewell Edition",
  "Landmark Edition",
  "Valhalla Edition",
  "VR Edition",
  "VR",
  "Collectors Edition",
  "Collection",
  "Extreme",
  "Extended Cut",
  "Extended",
  "Slightly Better Edition",
];

function sanitizeGameName(name: string): string {
  let sanitized = name
    .replaceAll("™", "")
    .replaceAll("®", "")
    .replaceAll("©", "")
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replaceAll("&", "and")
    .replaceAll(":", "")
    .replaceAll(",", "")
    .replaceAll(".", "")
    .replaceAll("'", "")
    .replaceAll("’", "")
    .replaceAll("`", "")
    .replaceAll("!", "")
    .replaceAll("?", "")
    .replaceAll("+", "")
    .replaceAll("–", " ")
    .replaceAll("“", "")
    .replaceAll("”", "")
    .replaceAll("‘", "")
    .replaceAll("’", "")
    .toLowerCase()
    .replaceAll("ō", "o")
    .replaceAll("é", "e")
    .replaceAll("á", "a")
    .replaceAll("í", "i")
    .replaceAll("ú", "u")
    .replaceAll("ñ", "n")
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u")
    .replaceAll("û", "u")
    .replaceAll("ß", "ss")
    .replaceAll("æ", "ae")
    .replaceAll("ø", "o")
    .replaceAll("å", "a")
    .replaceAll("ç", "c")
    .replaceAll("œ", "oe")
    .replaceAll("ğ", "g")
    .replaceAll("ş", "s")
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .toLowerCase() // Just in case.
    .trim();

  // Special cases:

  sanitized = sanitized.replaceAll("episode0", "episode ");

  for (const stringToRemove of GAME_NAME_STRINGS_TO_IGNORE) {
    const lowerStringToRemove = stringToRemove.toLowerCase();

    sanitized = sanitized.replaceAll(lowerStringToRemove, "");
  }

  const romanToArabicMap: Record<string, string> = {
    " x": " 10",
    " ix": " 9",
    " viii": " 8",
    " vii": " 7",
    " vi": " 6",
    " v": " 5",
    " iv": " 4",
    " iii": " 3",
    " ii": " 2",
    " i": " 1",
  };

  for (const [roman, arabic] of Object.entries(romanToArabicMap)) {
    sanitized = sanitized.replaceAll(new RegExp(roman + "(\\s|$)", "g"), arabic + " ");
  }

  return sanitized.replaceAll(" ", "").trim();
}
