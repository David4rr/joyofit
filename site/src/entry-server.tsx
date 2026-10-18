import { renderToString } from "react-dom/server";

import { App } from "./App";

/** HTML for the inside of #app at [path]; scripts/prerender.ts loads this through Vite's SSR loader. */
export function render(path: string): string {
  return renderToString(<App path={path} />);
}
