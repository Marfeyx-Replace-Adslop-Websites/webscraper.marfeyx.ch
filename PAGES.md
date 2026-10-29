# GitHub Pages

Deploy this repository using GitHub Actions (Settings -> Pages -> Build and deployment -> Source). The included workflow builds and uploads dist/; do not publish the repository root or src/ as a static site.

The build automatically checks the Pages artifact. Before upload, the workflow uses Chromium to verify startup at both the domain root and a repository subpath on desktop and phone-sized screens. A startup error or missing local asset stops deployment.

~~~sh
npm ci
npm run build
npx playwright install chromium
npm run test:pages
~~~

The check-only command is npm run check:pages. The workflow supplies Chromium's Linux system dependencies automatically. The repository's CNAME, custom-domain setting, and DNS must match.

Keep the existing WEBSCRAPER_CONFIG_JS_B64 repository secret configured; its production config is required by the workflow.
