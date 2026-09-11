import {
  ApplicationConfig,
  importProvidersFrom,
  provideZoneChangeDetection,
} from "@angular/core";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { provideRouter, withInMemoryScrolling } from "@angular/router";
import { LucideAngularModule } from "lucide-angular";

import { APP_ROUTES } from "./app.routes";
import { APP_ICONS } from "./icons";

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      APP_ROUTES,
      withInMemoryScrolling({ scrollPositionRestoration: "enabled" }),
    ),
    provideHttpClient(withFetch()),
    importProvidersFrom(LucideAngularModule.pick(APP_ICONS)),
  ],
};
