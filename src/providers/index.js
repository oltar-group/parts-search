import { UniqTradeProvider } from "./uniqtrade.js";
import { SLineProvider } from "./sline.js";
import { TehnomirProvider } from "./tehnomir.js";
import { AutonovaProvider } from "./autonova.js";

export function createProviders(config) {
  const providers = [new UniqTradeProvider(config.uniqtrade)];
  const sline = new SLineProvider(config.sline);
  if (sline.isConfigured()) {
    providers.push(sline);
  }
  const tehnomir = new TehnomirProvider(config.tehnomir);
  if (tehnomir.isConfigured()) {
    providers.push(tehnomir);
  }
  const autonova = new AutonovaProvider(config.autonova);
  if (autonova.isConfigured()) {
    providers.push(autonova);
  }
  return providers;
}
