import { UniqTradeProvider } from "./uniqtrade.js";
import { SLineProvider } from "./sline.js";

export function createProviders(config) {
  const providers = [new UniqTradeProvider(config.uniqtrade)];
  const sline = new SLineProvider(config.sline);
  if (sline.isConfigured()) {
    providers.push(sline);
  }
  return providers;
}
