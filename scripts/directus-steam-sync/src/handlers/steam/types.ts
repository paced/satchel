export interface BasicSteamGameInfo {
  isAdmin?: boolean;

  appId: number;
  hours: number;

  lastPlayed?: string;
  lastPlayedUnix?: number;
}

export interface ProcessedSteamGameInfo {
  // First step:

  basicData?: BasicSteamGameInfo;

  // Second step:

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

  metacritic_score?: number | null;

  categories: string[];
  genres: string[];

  release_date_string?: string;
  release_date_timestamp?: number;

  // Third step:

  last_review_update_timestamp?: number;
  review_category?: string | null;
  total_positive_reviews?: number;
  total_negative_reviews?: number;
  total_reviews?: number;

  // Fourth step:

  last_hltb_update_timestamp?: number;
  hltb_hours?: number;
  hltb_hours_extra?: number;
  hltb_hours_completionist?: number;
  hltb_name?: string;
  hltb_url?: string;
}
