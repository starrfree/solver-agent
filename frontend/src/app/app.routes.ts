import { Routes } from "@angular/router";

import { ConversationViewComponent } from "./conversation-view.component";
import { EmptyStateRouteComponent } from "./empty-state-route.component";

export const APP_ROUTES: Routes = [
  { path: "", component: EmptyStateRouteComponent, pathMatch: "full" },
  { path: "c/:id", component: ConversationViewComponent },
  { path: "**", redirectTo: "" },
];
