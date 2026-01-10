import pino from "pino";

export function createLogger(verbose?: boolean) {
  return pino({
    level: verbose ? "debug" : "info",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  });
}
