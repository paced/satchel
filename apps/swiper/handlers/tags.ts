const TAGS_TO_REMOVE = [
  "custom volume controls",
  "keyboard only option",
  "stereo sound",
  "surround sound",
  "valve anti-cheat enabled",
  "remote play together",
  "family sharing",
  "steam achievements",
  "steam cloud",
  "steam leaderboards",
  "steam trading cards",
  "partial controller support",
  "full controller support",
  "remote play on phone",
  "remote play on tablet",
  "touch only option",
  "mouse only option",
  "adjustable difficulty",
  "captions available",
  "adjustable text size",
  "stats",
  "color alternatives",
  "camera comfort",
  "remote play on tv",
  "steam turn notifications",
];

interface TagsWithColor {
  name: string;
  color: string;
}

/**
 * Combine and determine tag ordering and colours based on a custom sorting algorithm.
 *
 * @param steamTags {string[]} the more system-like Steam tags
 * @param userTags {{ name: string, score: number }[]} the more useful user-defined tags with scores
 * @returns {TagsWithColor[]} the combined tags with colours
 */
export function determineTags(steamTags: string[], userTags: { name: string; score: number }[]): TagsWithColor[] {
  const combinedTagMap: Record<string, TagsWithColor> = {};

  const highestScore = Math.max(...userTags.map((tag) => tag.score), 0);
  const lowestScore = Math.min(...userTags.map((tag) => tag.score), 0);

  const redThreshold = lowestScore + (highestScore - lowestScore) * 0.9;
  const orangeThreshold = lowestScore + (highestScore - lowestScore) * 0.925;
  const yellowThreshold = lowestScore + (highestScore - lowestScore) * 0.95;
  const greenThreshold = lowestScore + (highestScore - lowestScore) * 0.975;

  userTags.forEach((tag) => {
    let color = "cyan";
    if (tag.score <= redThreshold) {
      color = "red";
    } else if (tag.score <= orangeThreshold) {
      color = "orange";
    } else if (tag.score <= yellowThreshold) {
      color = "yellow";
    } else if (tag.score <= greenThreshold) {
      color = "green";
    }

    combinedTagMap[tag.name.toLowerCase()] = { name: tag.name, color };
  });

  steamTags.forEach((tag) => {
    const lowerTag = tag.toLowerCase();
    if (!combinedTagMap[lowerTag]) {
      combinedTagMap[lowerTag] = { name: tag, color: "blue" };
    }
  });

  const combinedTags = Object.values(combinedTagMap);

  combinedTags.sort((a, b) => {
    const colorPriority: Record<string, number> = {
      red: 6,
      orange: 5,
      yellow: 4,
      green: 3,
      cyan: 2,
      blue: 1,
    };

    if (colorPriority[a.color] !== colorPriority[b.color]) {
      return colorPriority[a.color] - colorPriority[b.color];
    }

    return a.name.localeCompare(b.name);
  });

  return combinedTags.filter((tag) => !TAGS_TO_REMOVE.includes(tag.name.toLowerCase()));
}
