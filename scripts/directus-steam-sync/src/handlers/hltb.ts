import { Logger } from "pino";
import sleep from "../utils/sleep";
import { ProcessedSteamGameInfo } from "./steam/types";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

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

  let failedAttempts = 0;

  for (const gameInfo of gameInfos) {
    logger.debug("querying HLTB for game: %s", gameInfo.name);

    if (gameInfo.last_hltb_update_timestamp && finalOptions.useCache) {
      logger.debug("skipping HLTB fetch for %s as data already exists", gameInfo.name);

      continue;
    }

    await sleep(HLTB_API_SLEEP_MS_BASE + failedAttempts * 1000);

    try {
      const searchQuery = gameInfo.name.replaceAll("™", "").replaceAll("®", "")

      const response = await makeHtlbSearchRequest(searchQuery, authToken);
      const result = response.data;

      if (result && result.length > 0) {
        const hltbData = result[0];

        logger.debug(
          "fetched HLTB data for %s: main=%d, main+extras=%d, completionist=%d",
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

      logger.warn("will retry HLTB data fetch for %s after re-capturing auth token (failed attempts: %d)", gameInfo.name, failedAttempts);

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
            modifier: "",
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
