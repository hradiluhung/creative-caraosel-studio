/**
 * Load cost of the two pages: the JavaScript and CSS each page's HTML asks for up front.
 * Code that is fetched later (other dashboard tabs, zip library, video export) is not in the HTML
 * and therefore not counted, which is the point of loading it later.
 *   BASE_URL=http://localhost:3210 node tests/perf-load.mjs
 * It measures and prints; pass a number of KB as the first argument to fail above that budget
 * for the dashboard's compressed JavaScript.
 */
import { gzipSync } from "node:zlib";

const BASE = process.env.BASE_URL || "http://localhost:3210";
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

async function measure(path) {
  const html = await (await fetch(`${BASE}${path}`)).text();
  const urls = [...new Set(html.match(/\/_next\/static\/[^"'\\\s)<>]+\.(?:js|css)/g) ?? [])];
  let js = 0, jsGzip = 0, css = 0, files = 0;
  for (const url of urls) {
    const body = Buffer.from(await (await fetch(`${BASE}${url}`)).arrayBuffer());
    if (url.endsWith(".css")) css += body.length;
    else {
      files += 1;
      js += body.length;
      jsGzip += gzipSync(body).length;
    }
  }
  console.log(`${path.padEnd(8)} JavaScript up front: ${files} files, ${kb(js)} (${kb(jsGzip)} gzipped), CSS ${kb(css)}`);
  return { js, jsGzip };
}

const dashboard = await measure("/");
const editor = await measure("/editor");
console.log(JSON.stringify({ dashboardGzipKb: Math.round(dashboard.jsGzip / 1024), editorGzipKb: Math.round(editor.jsGzip / 1024) }));
const budget = Number(process.argv[2]);
if (budget && dashboard.jsGzip / 1024 > budget) {
  console.log(`dashboard JavaScript is over the budget of ${budget} KB gzipped`);
  process.exit(1);
}
