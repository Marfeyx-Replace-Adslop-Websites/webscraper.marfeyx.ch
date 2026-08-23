# Marfeyx' Webscraper

[Open the live site](https://webscraper.marfeyx.ch/) · [Report a security issue](SECURITY.md)

Marfeyx' Webscraper helps people review their public online footprint. Enter up to three aliases to check a curated catalogue of 1,372 public platforms, then receive a source-linked report with confirmed and uncertain matches clearly separated.

It is designed for legitimate self-audits, account monitoring, and authorized research—not for surveillance, harassment, credential attacks, or access-control bypasses.

## What it does

- Checks a focused set of 600 high-priority platforms or the full HTTPS catalogue.
- Uses server-side, resumable scan chunks so an in-progress scan can continue after the browser is closed.
- Retains only useful result rows and automatically expires scan data within 24 hours.
- Keeps browser input constrained to aliases and server-selected platform IDs; users cannot submit arbitrary URLs.

## Privacy and safety

The project works only with public profile locations and public platform APIs. It does not sign in to services, request passwords, access private profiles, or create advertising profiles.

Each request is bounded by fixed destinations, rate limits, small concurrency pools, timeouts, response-size limits, and redirect controls. A match is evidence, not proof that two accounts belong to the same person. See [Safety](https://webscraper.marfeyx.ch/safety.html), [Privacy](https://webscraper.marfeyx.ch/privacy.html), and [Terms](https://webscraper.marfeyx.ch/terms.html) for the public policies.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html`, `app.js`, `styles.css` | Static scanner application |
| `results/`, `results.js` | Dedicated scan-report page |
| `data/platforms.json` | Curated public-platform catalogue |
| `supabase/functions/alias-scan` | Rate-limited Edge Function for scans and report delivery |
| `supabase/migrations` | Database schema, RLS policies, retention, and rate limits |
| `scripts/` | Build and catalogue validation tools |
| `.github/workflows/pages.yml` | GitHub Pages validation and deployment |

Historical frontend snapshots are kept in Git history rather than in the working tree.

## Validate a change

Run the project checks before opening a pull request:

```bash
npm run check
npm run build
```

`npm run check` validates the JavaScript sources, platform catalogue, safe URLs, and required gaming definitions. `npm run build` produces the deployable `dist/` artifact.

## Deploy and configure

The public site is deployed through GitHub Pages. Its runtime Supabase configuration is never committed:

1. Create a Supabase project, preferably in a European region, and apply the SQL files in `supabase/migrations` in filename order.
2. Deploy the `alias-scan` Edge Function with the repository's function configuration.
3. Set `RATE_LIMIT_SALT`; optionally set `RESEND_API_KEY` and `REPORT_FROM` for report email delivery.
4. Copy `config.example.js` to the ignored `config.js` and enter the project URL plus a **publishable** key. Never place a Supabase secret or service-role key in frontend code.
5. Base64-encode the completed `config.js` and save it as the GitHub Actions secret `WEBSCRAPER_CONFIG_JS_B64`. The Pages workflow injects it only into the deployment artifact.

The browser-facing Supabase URL and publishable key are intentionally public client configuration; database access is protected by the backend and RLS policies. Never expose a service-role or secret key.

## Contributing

Contributions are welcome for safe platform definitions, accessibility, reliability, and documentation. Keep platform checks HTTPS-only, preserve the server-side URL allowlist, and do not commit runtime configuration, credentials, generated artifacts, or personal scan data.

Platform definitions are adapted from the MIT-licensed [Sherlock Project](https://github.com/sherlock-project/sherlock) and [Maigret](https://github.com/soxoj/maigret). Their source notices are retained in `licenses/`.

## License

This project is released under the [MIT License](LICENSE).
