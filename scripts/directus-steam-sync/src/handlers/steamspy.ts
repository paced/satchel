import { ProcessedSteamGameInfo } from "./steam/types";
import { Logger } from "pino";
import { logProgress } from "../utils/logger";
import sleep from "../utils/sleep";

const STEAM_SPY_API_ENDPOINT = "https://steamspy.com/api.php";

const FetchSteamSpyDataDefaultOptions: FetchSteamSpyDataOptions = {
  useCache: true,
};

interface FetchSteamSpyDataOptions {
  useCache?: boolean;
}

/**
 * Sleep time between SteamSpy API requests to avoid rate limiting.
 *
 * ## Notes
 *
 * The API docs directly tell us the rate limit is 1 request per second, but to be safe, we use 1.5 seconds.
 */
const STEAM_SPY_API_SLEEP_MS = 1500;

export async function fetchSteamSpyDataForAppIds(
  gameInfos: ProcessedSteamGameInfo[],
  options = FetchSteamSpyDataDefaultOptions,
  logger: Logger,
) {
  logger.info("fetching SteamSpy data for %d games...", gameInfos.length);

  const finalOptions: FetchSteamSpyDataOptions = { ...FetchSteamSpyDataDefaultOptions, ...options };

  for (const gameInfo of gameInfos) {
    logProgress(gameInfos.indexOf(gameInfo) + 1, gameInfos.length, "SteamSpy info", logger);

    if (gameInfo.spy_update_timestamp && finalOptions.useCache) {
      logger.debug("skipping SteamSpy fetch for %s as data already exists", gameInfo.name);

      continue;
    }

    await sleep(STEAM_SPY_API_SLEEP_MS);

    try {
      const response = await fetch(`${STEAM_SPY_API_ENDPOINT}?request=appdetails&appid=${gameInfo.appId}`);
      const data = await response.json();

      if (data && data.name) {
        logger.info(
          "fetched new SteamSpy data for App ID %d (%s): owners=%s, average_2weeks=%d, average_forever=%d",
          gameInfo.appId,
          gameInfo.name,
          data.owners,
          data.average_2weeks,
          data.average_forever,
        );

        // These can _only_ be found from SteamSpy:

        gameInfo.spy_average_forever = data.average_forever || 0;
        gameInfo.spy_average_2weeks = data.average_2weeks || 0;
        gameInfo.spy_median_forever = data.median_forever || 0;
        gameInfo.spy_median_2weeks = data.median_2weeks || 0;

        if (data.tags) {
          gameInfo.spy_tags = Object.keys(data.tags).map((tagName) => ({
            name: tagName,
            score: data.tags[tagName],
          }));
        } else {
          gameInfo.spy_tags = [];
        }

        // These can be found from the reviews API, but we're getting them here for speed.

        gameInfo.total_positive_reviews = data.positive || 0;
        gameInfo.total_negative_reviews = data.negative || 0;
        gameInfo.total_reviews = (gameInfo.total_positive_reviews || 0) + (gameInfo.total_negative_reviews || 0);
        gameInfo.review_category = determineReviewCategory(
          gameInfo.total_positive_reviews || 0,
          gameInfo.total_negative_reviews || 0,
        );
      } else {
        logger.warn("no SteamSpy data found for App ID %d (%s)", gameInfo.appId, gameInfo.name);
      }

      gameInfo.spy_update_timestamp = new Date().getTime();
    } catch (err) {
      logger.error("failed to fetch SteamSpy data for App ID %d (%s): %s", gameInfo.appId, gameInfo.name, err);
    }
  }

  logger.info("completed fetching SteamSpy data");

  return gameInfos;
}

const REVIEWS_TOO_FEW_THRESHOLD = 10;
const REVIEWS_VERY_THRESHOLD = 50;
const REVIEWS_OVERWHELMINGLY_THRESHOLD = 500;

/**
 * Determine a Steam-like total review category such as "Very Positive" based on a modification of what Steam uses.
 *
 * @param totalPositive {number} the total number of positive reviews
 * @param totalNegative {number} the total number of negative reviews
 * @returns {string | null} the review category, or null if there are too few reviews
 */
function determineReviewCategory(totalPositive: number, totalNegative: number): string | null {
  const totalReviews = totalPositive + totalNegative;

  if (totalReviews < REVIEWS_TOO_FEW_THRESHOLD) {
    return null;
  }

  const positivePercentage = (totalPositive / totalReviews) * 100;

  if (totalReviews >= REVIEWS_OVERWHELMINGLY_THRESHOLD && positivePercentage >= 95) {
    return "Overwhelmingly Positive";
  } else if (positivePercentage >= 80) {
    if (totalReviews >= REVIEWS_VERY_THRESHOLD) {
      return "Very Positive";
    } else {
      return "Positive";
    }
  } else if (positivePercentage >= 70) {
    return "Mostly Positive";
  } else if (positivePercentage >= 40) {
    return "Mixed";
  } else if (positivePercentage >= 20) {
    return "Mostly Negative";
  }

  if (totalReviews >= REVIEWS_OVERWHELMINGLY_THRESHOLD) {
    return "Overwhelmingly Negative";
  } else if (totalReviews >= REVIEWS_VERY_THRESHOLD) {
    return "Very Negative";
  }

  return "Negative";
}
