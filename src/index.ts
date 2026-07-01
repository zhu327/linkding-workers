import { Hono } from "hono";
import type { Env } from "./env.js";
import { healthRouter } from "./health.js";
import { userRoutes } from "./api/user.js";
import { tagRoutes } from "./api/tags.js";
import { bookmarkRoutes } from "./api/bookmarks.js";
import { bundleRoutes } from "./api/bundles.js";
import { webRouter } from "./web/routes.js";

export const app = new Hono<{ Bindings: Env }>();
app.route("/", healthRouter);
app.route("/api/user", userRoutes);
app.route("/api/tags", tagRoutes);
app.route("/api/bookmarks", bookmarkRoutes);
app.route("/api/bundles", bundleRoutes);
app.route("/", webRouter);

// Workers default export with trailing-slash normalization.
// The linkding API uses trailing slashes (e.g. /api/tags/) but Hono routes are strict.
// This wrapper strips trailing slashes so both /api/tags and /api/tags/ work.
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
      request = new Request(url.toString(), request);
    }
    return app.fetch(request, env, ctx);
  },
};
