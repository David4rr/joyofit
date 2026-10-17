import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import "./index.css";
import { App } from "./App";
import { normalizePath } from "./seo";

const root = document.getElementById("app")!;
const app = (
  <StrictMode>
    <App path={normalizePath(window.location.pathname)} />
  </StrictMode>
);

// Built pages arrive prerendered (scripts/prerender.ts); the dev server serves an empty #app.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
