import { esc } from "./layout.js";

export function loginPage(csrfToken?: string, error?: string): string {
  const csrf = csrfToken ? `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">` : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login — linkding</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#e8e8e8;display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{background:#16213e;border:1px solid #3a3a5c;border-radius:8px;padding:2rem;width:100%;max-width:380px}
h1{font-size:1.5rem;margin-bottom:1.5rem;text-align:center}
.form-group{margin-bottom:1rem}
.form-group label{display:block;margin-bottom:.25rem;font-weight:500}
.form-control{width:100%;padding:.5rem .75rem;border:1px solid #3a3a5c;border-radius:4px;background:#1a1a2e;color:#e8e8e8;font-size:.95rem}
.form-control:focus{outline:none;border-color:#6c8cff}
.btn{display:block;width:100%;padding:.6rem;border:none;border-radius:4px;background:#4361ee;color:#fff;cursor:pointer;font-size:1rem;font-weight:500}
.btn:hover{background:#3a56d4}
.error{color:#ff6b6b;margin-bottom:1rem;text-align:center;font-size:.9rem}
</style></head><body>
<div class="login-box">
<h1>linkding</h1>
${error ? `<div class="error">${esc(error)}</div>` : ""}
<form method="POST" action="/login">
${csrf}
<div class="form-group"><label for="password">Password</label><input type="password" id="password" name="password" class="form-control" autofocus required></div>
<button type="submit" class="btn">Login</button>
</form>
</div></body></html>`;
}
