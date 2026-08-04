# Marfeyx' Webscraper

Marfeyx' Webscraper searches up to three aliases across a curated catalogue of 455 public platforms. The frontend is a dependency-free static site hosted on GitHub Pages. Supabase is the only application backend and provides short-lived scan storage, abuse controls, and a tightly allowlisted Edge Function for checks that browsers cannot read because of CORS.

## Architecture

- `index.html`, `styles.css`, `app.js`: static GitHub Pages application
- `data/platforms.json`: non-NSFW HTTPS platform catalogue derived from the MIT-licensed Sherlock Project
- `supabase/functions/alias-scan`: validated, rate-limited scan and report-delivery API
- `supabase/migrations`: RLS-protected, 24-hour scan storage and atomic rate limits
- `.github/workflows/pages.yml`: validates and deploys only the static `dist/` artifact

The Edge Function accepts platform IDs—not URLs. Every destination is looked up in the bundled catalogue. Requests use low concurrency, strict timeouts, manual redirects, fixed methods, payload limits and per-client/global rate limits.

## Configure Supabase

1. Create a Supabase project in a European region.
2. Apply `supabase/migrations/20260804093000_create_aliastrace_schema.sql`.
3. Deploy `supabase/functions/alias-scan` with JWT verification disabled. The function validates the modern publishable key itself because modern Supabase keys are not JWTs.
4. Optionally add a random `RATE_LIMIT_SALT` function secret. Without one, the injected Supabase secret key is used as the non-public salt.
5. For automatic report email, add `RESEND_API_KEY` and optionally `REPORT_FROM`. The sending domain must be verified by the email provider. Without it, the UI opens a local email-client fallback.
6. Put the project URL and publishable key in `config.js`. Never put a Supabase secret/service-role key in the frontend.

## Local preview

```bash
npm run check
npm run build
python -m http.server 8000
```

Open `http://localhost:8000`. Add `?demo=1` to exercise the complete UI without making external requests.

## GitHub Pages

Enable **Settings → Pages → Source: GitHub Actions**. The included workflow publishes the static artifact and the `CNAME` file maps it to `webscraper.marfeyx.ch`. Configure the matching DNS record separately.

## Privacy and limitations

Scan results expire within 24 hours. Alias matches are not identity proof. Some platforms block automated access, change profile patterns, require authentication, or return misleading status pages, so the report separates confirmed, uncertain, missing and blocked checks.

Platform definitions are adapted from the [Sherlock Project](https://github.com/sherlock-project/sherlock). Its MIT license is preserved in `licenses/Sherlock-LICENSE.txt`.
