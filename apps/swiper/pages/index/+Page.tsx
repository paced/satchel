import { RestClient, createDirectus, readItems, rest, serverPing, staticToken } from "@directus/sdk";
import { Carousel, CarouselSlide } from "@mantine/carousel";
import {
  Anchor,
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Grid,
  GridCol,
  Image,
  Input,
  InputLabel,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { compactInteger } from "humanize-plus";
import { ChangeEvent, useCallback, useEffect, useState } from "react";

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

export default function Home() {
  const [directusUrl, setDirectusUrl] = useLocalStorage<string>({ key: "directusUrl", defaultValue: "" });
  const [directusToken, setDirectusToken] = useLocalStorage<string>({ key: "directusToken", defaultValue: "" });
  const [directusClient, setDirectusClient] = useState<RestClient<any> | null>(null);
  const [inMemoryGameItems, setInMemoryGameItems] = useState<any[] | null>(null);
  const [inMemoryGameItemIndex, setInMemoryGameItemIndex] = useState<number>(0);
  const [isDirectusFormShown, setIsDirectusFormShown] = useState<boolean>(true);

  const handleDirectusUrlChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setDirectusUrl(e.currentTarget.value);
    },
    [setDirectusUrl],
  );

  const handleDirectusTokenChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      setDirectusToken(e.currentTarget.value);
    },
    [setDirectusToken],
  );

  useEffect(() => {
    if (directusUrl && directusToken) {
      const client = createDirectus(directusUrl).with(staticToken(directusToken)).with(rest());

      setDirectusClient(client);
      setIsDirectusFormShown(false);
    } else {
      setDirectusClient(null);
    }
  }, [directusUrl, directusToken]);

  if (isDirectusFormShown || !directusUrl || !directusToken) {
    return (
      <Container h="95vh">
        <Flex align="center" justify="center" h="100%">
          <Box>
            <Title mt="xl">Setup Directus Connection</Title>
            <Text mt="md" mb="xl">
              This app saves your Directus connection in the local storage of your web browser.
            </Text>
            <form>
              <InputLabel htmlFor="directus-url-input">Directus URL</InputLabel>
              <Input
                mt="xs"
                mb="xl"
                type="url"
                placeholder="https://directus.example.com"
                value={directusUrl}
                onChange={handleDirectusUrlChange}
              />
              <InputLabel htmlFor="directus-token-input">Directus Access Token</InputLabel>
              <Input
                mt="xs"
                mb="xl"
                type="text"
                placeholder="your-directus-access-token"
                value={directusToken}
                onChange={handleDirectusTokenChange}
              />
            </form>
            <Stack gap="sm">
              <Button onClick={() => setIsDirectusFormShown(false)}>Save Directus Connection</Button>
              <Button
                variant="outline"
                disabled={!directusClient}
                onClick={() => {
                  directusClient?.request(serverPing()).then((result) => {
                    if (result === "pong") {
                      alert("Connection successful!");
                    }
                  });
                }}
              >
                Test Connection
              </Button>
            </Stack>
          </Box>
        </Flex>
      </Container>
    );
  }

  if (!inMemoryGameItems) {
    return (
      <Container>
        <Flex align="center" justify="center" h="95vh">
          <Box>
            <Title>Empty.</Title>
            <Text mt="md">Your queue is empty.</Text>
            <Stack gap="sm" mt="xl">
              <Button
                onClick={async () => {
                  if (directusClient) {
                    const items = await loadGameItems(directusClient, 100);
                    setInMemoryGameItems(items);
                  }
                }}
              >
                Load up a new queue!
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  setIsDirectusFormShown(true);
                }}
              >
                Change Directus Connection
              </Button>
            </Stack>
          </Box>
        </Flex>
      </Container>
    );
  }

  const currentGame = inMemoryGameItems[inMemoryGameItemIndex];

  const steamReviewsText =
    currentGame?.Steam_Positive_Reviews && currentGame?.Steam_Negative_Reviews ? currentGame.Review_Category : "N/A";

  let metacriticColor = "red";
  if (currentGame?.Metacritic_Score >= 50 && currentGame?.Metacritic_Score < 70) {
    metacriticColor = "orange";
  } else if (currentGame?.Metacritic_Score >= 70 && currentGame?.Metacritic_Score < 80) {
    metacriticColor = "yellow";
  } else if (currentGame?.Metacritic_Score >= 80 && currentGame?.Metacritic_Score < 90) {
    metacriticColor = "green";
  } else if (currentGame?.Metacritic_Score >= 90) {
    metacriticColor = "teal";
  } else if (currentGame?.Metacritic_Score === null || currentGame?.Metacritic_Score === undefined) {
    metacriticColor = "darkgrey";
  }

  let steamSentimentColor = "red";
  if (steamReviewsText === "Mixed") {
    steamSentimentColor = "orange";
  } else if (steamReviewsText === "Mostly Positive" || steamReviewsText === "Positive") {
    steamSentimentColor = "green";
  } else if (steamReviewsText === "Very Positive" || steamReviewsText === "Overwhelmingly Positive") {
    steamSentimentColor = "teal";
  } else if (!steamReviewsText) {
    steamSentimentColor = "darkgrey";
  }

  // TODO: 1) images do not load instantly when moving from page to page, 2) inconsistent heights of carousel.

  return (
    <Container>
      <Text mt="md" size="xs" style={{ textAlign: "center" }}>
        Game {inMemoryGameItemIndex + 1} of {inMemoryGameItems.length} in queue...
      </Text>
      <Box mt="xs">
        <Carousel
          slideSize="55%"
          slideGap="sm"
          controlsOffset="sm"
          controlSize={32}
          withControls
          withIndicators={true}
          flex={1}
        >
          {(currentGame.Screenshots?.split("\n") || []).map((screenshotUrl: string, index: number) => (
            <CarouselSlide key={index}>
              <Image src={screenshotUrl} style={{ height: "384px", objectFit: "contain" }} />
            </CarouselSlide>
          ))}
        </Carousel>
      </Box>
      <Title mt="md">{currentGame?.Name}</Title>
      <Text size="xs">
        by {currentGame?.Developers.join(", ")}, release year:{" "}
        {currentGame?.Release_Date ? new Date(currentGame.Release_Date).getFullYear() : "N/A"}
      </Text>
      <Grid>
        <GridCol span={{ base: 12, md: 6 }} h="100%">
          <Box my="md" style={{ textAlign: "center" }}>
            {[...(currentGame?.Spy_Tags || []), ...(currentGame?.Tags || [])]
              .filter((tag: any) => !TAGS_TO_REMOVE.includes(tag.toLowerCase()))
              .map((tag: string) => (
                <Badge key={`tag-${tag}`} mr="xs" mb="xs" size="xs">
                  {tag}
                </Badge>
              ))}
          </Box>
          <Flex direction="row" align="center" justify="center" gap="xl" my="md">
            <Anchor href={currentGame?.URL} target="_blank" rel="noopener noreferrer" size="sm">
              View on {currentGame.Marketplace} Store
            </Anchor>
            {currentGame?.HLTB_URL ? (
              <Anchor href={currentGame?.HLTB_URL} target="_blank" rel="noopener noreferrer" size="sm">
                View on HLTB
              </Anchor>
            ) : null}
            <Anchor
              href={`${directusUrl}/admin/content/Game/${currentGame.id}`}
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
            >
              View on Directus
            </Anchor>
          </Flex>
        </GridCol>
        <GridCol span={{ base: 12, md: 6 }} style={{ alignSelf: "center" }}>
          <Text size="sm" my="auto">
            <i>{currentGame?.Description.replace("&amp;", "&")}</i>
          </Text>
        </GridCol>
      </Grid>

      <Grid my="md">
        <GridCol span={{ base: 12, md: 6 }}>
          <Flex direction="row" align="center" justify="center">
            <Flex direction="column" align="center">
              <Title order={6} c={metacriticColor}>
                {currentGame?.Metacritic_Score || "N/A"}
              </Title>
              <Text size="xs">Metacritic</Text>
            </Flex>
            <Flex direction="column" ml="lg" align="center">
              <Title order={6}>
                {currentGame?.Steam_Total_Reviews ? compactInteger(currentGame?.Steam_Total_Reviews, 1) : "N/A"}
              </Title>
              <Text size="xs">Steam Reviews</Text>
            </Flex>
            <Flex direction="column" ml="lg" align="center">
              <Title order={6} c={steamSentimentColor}>
                {steamReviewsText}
              </Title>
              <Text size="xs">Steam Sentiment</Text>
            </Flex>
          </Flex>
        </GridCol>
        <GridCol span={{ base: 12, md: 6 }}>
          <Flex direction="row" align="center" justify="center" mx="auto">
            <Flex direction="column" align="center">
              <Title order={6}>{currentGame?.HLTB_Hours || "N/A"}</Title>
              <Text size="xs">HLTB Main</Text>
            </Flex>
            <Flex direction="column" ml="lg" align="center">
              <Title order={6}>{currentGame?.HLTB_Extra || "N/A"}</Title>
              <Text size="xs">HLTB Extra</Text>
            </Flex>
            <Flex direction="column" ml="lg" align="center">
              <Title order={6}>{currentGame?.HLTB_Completionist || "N/A"}</Title>
              <Text size="xs">HLTB Comp.</Text>
            </Flex>
            <Flex direction="column" ml="lg" align="center">
              <Title order={6}>{currentGame?.Hours || "N/A"}</Title>
              <Text size="xs">Your Hours</Text>
            </Flex>
          </Flex>
        </GridCol>
      </Grid>
      <Box>
        <Button
          mr="sm"
          disabled={inMemoryGameItemIndex <= 0}
          onClick={() => {
            if (inMemoryGameItemIndex > 0) {
              setInMemoryGameItemIndex(inMemoryGameItemIndex - 1);
            }
          }}
        >
          Previous
        </Button>
        <Button
          disabled={inMemoryGameItemIndex >= inMemoryGameItems.length - 1}
          onClick={() => {
            if (inMemoryGameItemIndex < inMemoryGameItems.length - 1) {
              setInMemoryGameItemIndex(inMemoryGameItemIndex + 1);
            }
          }}
        >
          Next
        </Button>
      </Box>
    </Container>
  );
}

// Note: id is always required as the last option as many of these are optional.

const SORT_CHOICES = [
  "Name",
  "Metacritic_Score",
  "Release_Date",
  "Steam_Total_Reviews",
  "Steam_Positive_Reviews",
  "Steam_Negative_Reviews",
];

async function loadGameItems(directusClient: RestClient<any>, n: number): Promise<any[]> {
  // Despite what the docs say, random sorting is not possible in Directus yet. The way we solve for this is to use
  // pRNG to decide whether sorting is ascending or descending, and what the sort column should even be. The only
  // thing we're attempting to avoid here is showing the same items repeatedly if the user keeps skipping.

  const isIdDescending = Math.random() < 0.5;
  const sortColumn = SORT_CHOICES[Math.floor(Math.random() * SORT_CHOICES.length)];
  const isSortColumnDescending = Math.random() < 0.5;

  const results = await directusClient.request(
    readItems("Game", {
      limit: n,
      sort: [`${isSortColumnDescending ? "-" : ""}${sortColumn}`, `${isIdDescending ? "-" : ""}id`],
      filter: {
        Status: "Backlog",
        Drop_Status: "null",
      },
    }),
  );

  return results.sort(() => Math.random() - 0.5);
}
