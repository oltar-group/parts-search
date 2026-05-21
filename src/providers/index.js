import { UniqTradeProvider } from "./uniqtrade.js";

export function createProviders(config) {
  return [new UniqTradeProvider(config.uniqtrade)];
}

