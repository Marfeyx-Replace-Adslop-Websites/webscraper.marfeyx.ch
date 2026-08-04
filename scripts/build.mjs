import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html", "privacy.html", "terms.html", "safety.html", "sites.html", "404.html",
  "styles.css", "app.js", "sites.js", "config.js", "CNAME", ".nojekyll", "robots.txt", "sitemap.xml"
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/data", { recursive: true });
await mkdir("dist/assets", { recursive: true });
for (const file of files) await cp(file, `dist/${file}`);
await cp("data/platforms.json", "dist/data/platforms.json");
await cp("assets/marfeyx-avatar.jpg", "dist/assets/marfeyx-avatar.jpg");
console.log(`Built ${files.length + 2} static assets in dist/`);
