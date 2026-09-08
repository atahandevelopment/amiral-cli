import { PlaywrightVisualQAProvider } from "./providers/playwright-visual-qa.js";
import { VisualQAProviderRegistry, visualQAProviders } from "./visual-qa.js";

export function createVisualQAProviderRegistry(): VisualQAProviderRegistry {
  const registry = new VisualQAProviderRegistry();
  registry.register(new PlaywrightVisualQAProvider());
  return registry;
}

/** Concrete provider registration at the application composition boundary. */
export function registerBuiltInVisualQAProviders(): void {
  if (!visualQAProviders.has("playwright")) visualQAProviders.register(new PlaywrightVisualQAProvider());
}
