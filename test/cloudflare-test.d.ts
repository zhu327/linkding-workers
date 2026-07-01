declare module "cloudflare:test" {
  export const env: {
    DB: D1Database;
    [key: string]: any;
  };
  export function createExecutionContext(): ExecutionContext;
  export function waitOnExecutionContext(ctx: ExecutionContext): Promise<void>;
}
