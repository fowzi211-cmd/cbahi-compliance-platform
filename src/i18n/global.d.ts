import type { routing } from "./routing";
import type messages from "../../messages/ar.json";

// Arabic is the reference catalogue: a key missing from it is a type error.
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
