import { esc } from "./layout.js";

export function loginBody(csrfToken?: string, error?: string): string {
  const csrf = csrfToken ? `<input type="hidden" name="_csrf" value="${esc(csrfToken)}">` : "";
  return `<main class="auth-page" aria-labelledby="main-heading">
  <div class="section-header"><h1 id="main-heading">Login</h1></div>
  ${error ? `<p class="form-input-hint is-error">${esc(error)}</p>` : ""}
  <form method="post" action="/login">
    ${csrf}
    <div class="form-group">
      <label for="password" class="form-label">Password</label>
      <input type="password" id="password" name="password" class="form-input" autofocus required>
    </div>
    <input type="submit" value="Login" class="btn btn-primary width-100 mt-4">
  </form>
</main>`;
}
