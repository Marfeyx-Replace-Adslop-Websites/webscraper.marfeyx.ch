import { access, cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html", "sniper.html", "privacy.html", "terms.html", "safety.html", "sites.html", "404.html",
  "styles.css", "app.js", "results.js", "sites.js", "sniper.js", "claim-platforms.js", "CNAME", ".nojekyll", "robots.txt", "sitemap.xml"
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
