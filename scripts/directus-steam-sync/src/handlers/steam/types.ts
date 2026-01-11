export interface BasicSteamGameInfo {
  appId: number;
  hours: number;

  lastPlayed?: string;
  lastPlayedUnix?: number;
}

export interface ProcessedSteamGameInfo {
  basicData?: BasicSteamGameInfo;

  appId: number;
  query: string;

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
