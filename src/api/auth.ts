import type { MiddlewareHandler } from "hono";
import type { Env } from "../env.js";
import type { ApiTokenRow } from "../db/schema.js";

declare module "hono" {
  interface ContextVariableMap {
    apiToken: ApiTokenRow;
    _formData: FormData;
    anonymous: boolean;
  }
}

export const apiTokenAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (!auth) {
    return c.json({ detail: "Authentication credentials were not provided." }, 401);
  }

  const parts = auth.split(" ");
  if (parts.length !== 2) {
    return c.json({ detail: "Invalid token header." }, 401);
  }

  const keyword = parts[0].toLowerCase();
  if (keyword !== "token" && keyword !== "bearer") {
    return c.json({ detail: "Invalid token header." }, 401);
  }

  const key = parts[1];
  const row = await c.env.DB.prepare("SELECT * FROM api_tokens WHERE key = ?")
    .bind(key)
    .first<ApiTokenRow>();
  if (!row) {
    return c.json({ detail: "Invalid token." }, 401);
  }

  c.set("apiToken", row);
  await next();
};
