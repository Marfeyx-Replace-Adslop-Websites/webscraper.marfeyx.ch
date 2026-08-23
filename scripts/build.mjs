import { access, cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html", "sniper.html", "privacy.html", "terms.html", "safety.html", "sites.html", "404.html",
  "styles.css", "styles-1.4.css", "styles-1.5.css", "styles-1.6.css", "styles-1.7.css", "styles-1.9.css", "styles-2.0.css", "app.js", "app-1.4.js", "app-1.5.js", "app-1.6.js", "app-1.7.js", "app-1.8.js", "app-1.9.js", "app-2.0.js", "results-2.0.js", "sites.js", "sites-1.4.js", "sites-1.5.js", "sites-1.6.js", "sniper.js", "sniper-1.5.js", "sniper-1.6.js", "claim-platforms.js", "claim-platforms-1.6.js", "CNAME", ".nojekyll", "robots.txt", "sitemap.xml"
];

const runtimeConfig = await access("config.js").then(() => "config.js").catch(() => "config.example.js");

await rm("dist", { recursive: true, force: true });
await mkdir("dist/data", { recursive: true });
await mkdir("dist/assets", { recursive: true });
await mkdir("dist/results", { recursive: true });
for (const file of files) await cp(file, `dist/${file}`);
await cp(runtimeConfig, "dist/config.js");
await cp("data/platforms.json", "dist/data/platforms.json");
await cp("assets/marfeyx-avatar.jpg", "dist/assets/marfeyx-avatar.jpg");
await cp("results/index.html", "dist/results/index.html");
console.log(`Built ${files.length + 3} static assets in dist/`);
