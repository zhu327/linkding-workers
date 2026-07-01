import type { Context } from "hono";

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  APP_PASSWORD_HASH: string;
}

export type AppContext = Context<{ Bindings: Env }>;
