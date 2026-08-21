import { registerProvider } from "./generation-provider.js";
import { floyoProvider } from "./floyo-provider.js";
import { googleProvider } from "./google-provider.js";
import { kieProvider } from "./kie-provider.js";

let initialized = false;

export function initProviders() {
  if (initialized) return;
  registerProvider(floyoProvider);
  registerProvider(googleProvider);
  registerProvider(kieProvider);
  initialized = true;
}

export { floyoProvider, googleProvider, kieProvider };
