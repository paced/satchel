import pino from "pino";
import { config } from "dotenv";

const { parsed } = config();

const LOGGER = pino({
  level: parsed?.DEBUG === "1" || parsed?.DEBUG.toLowerCase() === "true" ? "debug" : "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

export default LOGGER;
