import "@fontsource/rubik/latin-400.css";
import "@mantine/carousel/styles.css";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { PropsWithChildren, StrictMode } from "react";

import "./globals.css";

export default function Layout({ children }: PropsWithChildren) {
  return (
    <StrictMode>
      <MantineProvider>
        <div id="base">
          <main>{children}</main>
        </div>
      </MantineProvider>
    </StrictMode>
  );
}
