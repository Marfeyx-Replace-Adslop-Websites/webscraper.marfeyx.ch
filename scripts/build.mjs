import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html", "sniper.html", "privacy.html", "terms.html", "safety.html", "sites.html", "404.html",
  "styles.css", "styles-1.4.css", "styles-1.5.css", "styles-1.6.css", "styles-1.7.css", "app.js", "app-1.4.js", "app-1.5.js", "app-1.6.js", "app-1.7.js", "sites.js", "sites-1.4.js", "sites-1.5.js", "sites-1.6.js", "sniper.js", "sniper-1.5.js", "sniper-1.6.js", "claim-platforms.js", "claim-platforms-1.6.js", "config.js", "CNAME", ".nojekyll", "robots.txt", "sitemap.xml"
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/data", { recursive: true });
await mkdir("dist/assets", { recursive: true });
for (const file of files) await cp(file, `dist/${file}`);
await cp("data/platforms.json", "dist/data/platforms.json");
await cp("assets/marfeyx-avatar.jpg", "dist/assets/marfeyx-avatar.jpg");
console.log(`Built ${files.length + 2} static assets in dist/`);
