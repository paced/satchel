import { Logger } from "pino";
import { BasicSteamGameInfo, ProcessedSteamGameInfo } from "./types";

export function mapSteamAppToProcessedGameInfo(
  basicData: BasicSteamGameInfo,
  data: any,
  query: string,
  logger: Logger,
): ProcessedSteamGameInfo | undefined {
  try {
    return {
      basicData,

      appId: data.steam_appid,
      query: query,

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

      release_date_string: data.release_date?.date,
      release_date_timestamp: data.release_date?.date ? new Date(data.release_date.date).getTime() : undefined,
    };
  } catch (err) {
    logger.error(`failed to process app ID %d: %s`, data.appId, err);
  }
}
