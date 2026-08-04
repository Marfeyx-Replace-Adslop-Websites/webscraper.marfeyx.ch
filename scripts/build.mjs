import { cp, mkdir, rm } from "node:fs/promises";

const files = [
  "index.html", "privacy.html", "terms.html", "404.html", "styles.css", "app.js",
  "config.js", "favicon.svg", "CNAME", ".nojekyll", "robots.txt", "sitemap.xml"
];

await rm("dist", { recursive: true, force: true });
await mkdir("dist/data", { recursive: true });
for (const file of files) await cp(file, `dist/${file}`);
await cp("data/platforms.json", "dist/data/platforms.json");
console.log(`Built ${files.length + 1} static assets in dist/`);
