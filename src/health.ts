import { Hono } from "hono";
import type { Env } from "./env.js";

export const healthRouter = new Hono<{ Bindings: Env }>();
healthRouter.get("/health", (c) => c.json({ status: "ok" }));
