// Note: id is always required as the last option as many of these are optional.
import { RestClient, readItems } from "@directus/sdk";

const SORT_CHOICES = [
  "Name",
  "Metacritic_Score",
  "Release_Date",
  "Steam_Total_Reviews",
  "Steam_Positive_Reviews",
  "Steam_Negative_Reviews",
];

const LARGER_PICK_GROUP_MULTIPLIER = 3;

export async function loadGameItems(directusClient: RestClient<any>, n: number) {
  // Despite what the docs say, random sorting is not possible in Directus yet. This is pseudorandom.

  const isIdDescending = Math.random() < 0.5;
  const sortColumn = SORT_CHOICES[Math.floor(Math.random() * SORT_CHOICES.length)];
  const isSortColumnDescending = Math.random() < 0.5;

  const results = await directusClient.request(
    readItems("Game", {
      limit: LARGER_PICK_GROUP_MULTIPLIER * n,
      sort: [`${isSortColumnDescending ? "-" : ""}${sortColumn}`, `${isIdDescending ? "-" : ""}id`],
      filter: {
        Status: "Backlog",
        Drop_Status: "null",
      },
    }),
  );

  return results.sort(() => Math.random() - 0.5).slice(0, n);
}
