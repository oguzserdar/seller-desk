// Draws the download offer's preview from the pack's real wallpapers (no invented imagery).
import { writeFileSync } from "node:fs";
import { SAMPLE_PACK_WALLPAPERS, wallpaper } from "../../../src/fixtures/sample-asset";

const cards = SAMPLE_PACK_WALLPAPERS.map((item, i) => {
  const svg = wallpaper(item.hues, item.seed).replace(/<svg /, '<svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" ')
    .replace('id="g"', `id="g${i}"`)
    .replace("url(#g)", `url(#g${i})`);
  const transforms = ["translate(-110px, -40px) rotate(-6deg)", "translate(0px, 30px) rotate(1.5deg)", "translate(110px, 110px) rotate(6deg)"];
  return `<div class="card" style="transform:${transforms[i]};z-index:${i === 1 ? 3 : i + 1}">${svg}</div>`;
}).join("");
writeFileSync(new URL("./preview.html", import.meta.url), `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1000px;height:1000px;background:#E9EBEE}
.stage{position:relative;width:1000px;height:1000px;display:grid;place-items:center}
.card{position:absolute;width:620px;height:349px;border-radius:10px;overflow:hidden;box-shadow:0 1px 2px rgb(30 34 44/.12),0 18px 40px -12px rgb(30 34 44/.28)}
.card svg{display:block}
</style><div class="stage">${cards}</div>`);
