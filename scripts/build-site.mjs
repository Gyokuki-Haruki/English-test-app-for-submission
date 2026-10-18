import { cp, mkdir, rm } from "node:fs/promises";

const pages = [
  "index.html",
  "login.html",
  "mywords.html",
  "words.html",
  "test_setting.html",
  "test.html",
];

await rm("site", { recursive: true, force: true });
await mkdir("site", { recursive: true });
await mkdir("site/assets", { recursive: true });
for (const page of pages) await cp(page, `site/${page}`);
await cp("photolex.css", "site/photolex.css");
await cp("label-picker.js", "site/label-picker.js");
await cp("icon-mark.png", "site/icon-mark.png");
await cp("assets/photolex-logo.png", "site/assets/photolex-logo.png");
await cp("assets/photolex-mark.png", "site/assets/photolex-mark.png");
console.log(`Prepared ${pages.length} web pages in site/`);
