import { type RestClient } from "@directus/sdk";
import { Carousel, CarouselSlide } from "@mantine/carousel";
import { Anchor, Badge, Box, Button, Container, Flex, Grid, GridCol, Image, Stack, Text, Title } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { compactInteger } from "humanize-plus";
import { useState } from "react";

import { loadGameItems } from "../../handlers/directus.ts";
import { determineTags } from "../../handlers/tags.ts";
import DirectusForm from "./partials/DirectusForm.tsx";

export default function Home() {
  const [directusUrl, _setDirectusUrl] = useLocalStorage<string>({ key: "directusUrl", defaultValue: "" });

  const [directusClient, setDirectusClient] = useState<RestClient<any> | null>(null);
  const [inMemoryGameItems, setInMemoryGameItems] = useState<any[] | null>(null);
  const [inMemoryGameItemIndex, setInMemoryGameItemIndex] = useState<number>(0);
  const [isDirectusFormShown, setIsDirectusFormShown] = useState<boolean>(true);

  if (isDirectusFormShown || !directusClient) {
    return (
      <DirectusForm
        directusClient={directusClient}
        setDirectusClient={setDirectusClient}
        setIsDirectusFormShown={setIsDirectusFormShown}
      />
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
        by {currentGame?.Developers ? currentGame?.Developers.join(", ") : "Unknown"}, release year:{" "}
        {currentGame?.Release_Date ? new Date(currentGame.Release_Date).getFullYear() : "N/A"}
      </Text>
      <Grid>
        <GridCol span={{ base: 12, md: 6 }} h="100%">
          <Box my="md" style={{ textAlign: "center" }}>
            {determineTags(currentGame?.Tags || [], currentGame?.Spy_Tags || []).map((tag: any, index: number) => (
              <Badge key={index} color={tag.color} variant="filled" mr="xs" mb="xs">
                {tag.name}
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
