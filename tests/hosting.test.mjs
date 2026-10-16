import { test } from "node:test";
import assert from "node:assert/strict";
assert.equal(process.env.GCLOUD_PROJECT, "demo-flowboard");
test("Hosting Emulator: SPA rewrites, executable assets, security headers and cache policy", async () => {
  const base = "http://127.0.0.1:5000";
  const home = await fetch(base + "/");
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /<div id="root"><\/div>/);
  const route = await fetch(base + "/boards/not-a-server-route");
  assert.equal(route.status, 200);
  assert.equal(await route.text(), html);
  assert.equal(home.headers.get("x-content-type-options"), "nosniff");
  assert.equal(home.headers.get("x-frame-options"), "DENY");
  assert.match(
    home.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(home.headers.get("referrer-policy"), "no-referrer");
  const asset = html.match(/src="([^\"]+\.js)"/)[1];
  const js = await fetch(base + asset);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type"), /javascript/);
  assert.match(js.headers.get("cache-control"), /immutable/);
  assert.ok((await js.text()).length > 1000);
});
