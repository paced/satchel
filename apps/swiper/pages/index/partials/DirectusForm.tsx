import { type RestClient, createDirectus, rest, serverPing, staticToken } from "@directus/sdk";
import { Box, Button, Container, Flex, Input, InputLabel, Stack, Text, Title } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { type ChangeEvent, useCallback, useEffect } from "react";

interface DirectusFormProps {
  directusClient: RestClient<never> | null;
  setDirectusClient: (client: RestClient<never> | null) => void;
  setIsDirectusFormShown: (isShown: boolean) => void;
}

export default function DirectusForm(props: DirectusFormProps) {
  const { directusClient, setDirectusClient, setIsDirectusFormShown } = props;

  const [directusUrl, setDirectusUrl] = useLocalStorage<string>({ key: "directusUrl", defaultValue: "" });
  const [directusToken, setDirectusToken] = useLocalStorage<string>({ key: "directusToken", defaultValue: "" });

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
