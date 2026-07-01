import { Hono } from "hono";
import type { Env } from "../env.js";
import { getProfile } from "../db/schema.js";
import { apiTokenAuth } from "./auth.js";
import { serializeUserProfile } from "./serializers.js";

const APP_VERSION = "1.45.0";

export const userRoutes = new Hono<{ Bindings: Env }>();
userRoutes.use("/*", apiTokenAuth);

userRoutes.get("/profile", async (c) => {
  const row = await getProfile(c.env.DB);
  if (!row) {
    return c.json({ detail: "Profile not found." }, 500);
  }
  return c.json(serializeUserProfile(row, APP_VERSION));
});

userRoutes.get("/profile/", async (c) => {
  const row = await getProfile(c.env.DB);
  if (!row) {
    return c.json({ detail: "Profile not found." }, 500);
  }
  return c.json(serializeUserProfile(row, APP_VERSION));
});
