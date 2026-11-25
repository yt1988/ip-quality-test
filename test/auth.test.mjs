import test from "node:test";
import assert from "node:assert/strict";
import { authFetch, authTargets, needsAuth } from "../src/auth.mjs";

const targets = authTargets({
  seg: "https://seg.example:8444",
  dns: "https://api.dns.example:2053",
  anchors: ["https://probe.example/conn", "https://probe2.example/conn"],
});
const url = "https://seg.example:8444/v1/seg?ip=1.2.3.4";

function calls({ statuses = [200], token = () => "", fresh = "new" } = {}) {
  const seen = [];
  let refreshed = 0;
  const fetchImpl = (u, init) => {
    seen.push({ u, auth: init.headers.get("Authorization") });
    return Promise.resolve({ status: statuses[Math.min(seen.length - 1, statuses.length - 1)] });
  };
  const refresh = async () => { refreshed++; return fresh; };
  return { seen, fetchImpl, refresh, get refreshed() { return refreshed; }, token };
}

test("auth targets: anchors, the seg origin and the DNS zone (random names too)", () => {
  assert.equal(needsAuth("https://probe.example/conn", targets), true);
  assert.equal(needsAuth("https://probe.example/fp", targets), true);
  assert.equal(needsAuth("https://seg.example:8444/v1/seg", targets), true);
  assert.equal(needsAuth("https://api.dns.example:2053/t/x", targets), true);
  assert.equal(needsAuth("https://abc-a.dns.example:2053/", targets), true);
  assert.equal(needsAuth("https://example.com/", targets), false);
});

test("no meta means no Authorization header", async () => {
  const c = calls();
  const r = await authFetch(url, {}, { token: c.token, refresh: c.refresh, targets, fetchImpl: c.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(c.seen.length, 1);
  assert.equal(c.seen[0].auth, null);
  assert.equal(c.refreshed, 0);
});

test("a meta token rides on the endpoint request", async () => {
  const c = calls({ token: () => "v1.1.n.scope.sig" });
  await authFetch(url, {}, { token: c.token, refresh: c.refresh, targets, fetchImpl: c.fetchImpl });
  assert.equal(c.seen[0].auth, "Bearer v1.1.n.scope.sig");
});

test("401 refreshes once and retries once with the new token", async () => {
  const c = calls({ statuses: [401, 200] });
  const r = await authFetch(url, {}, { token: () => "", refresh: c.refresh, targets, fetchImpl: c.fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(c.refreshed, 1);
  assert.equal(c.seen.length, 2);
  assert.equal(c.seen[1].auth, "Bearer new");
});

test("a second 401 is not retried again", async () => {
  const c = calls({ statuses: [401, 401, 200] });
  const r = await authFetch(url, {}, { token: () => "", refresh: c.refresh, targets, fetchImpl: c.fetchImpl });
  assert.equal(r.status, 401);
  assert.equal(c.refreshed, 1);
  assert.equal(c.seen.length, 2);
});

test("a non-endpoint URL never gets the token or a retry", async () => {
  const c = calls({ statuses: [401, 200], token: () => "v1.1.n.scope.sig" });
  const r = await authFetch("https://example.com/x", {}, { token: c.token, refresh: c.refresh, targets, fetchImpl: c.fetchImpl });
  assert.equal(r.status, 401);
  assert.equal(c.refreshed, 0);
  assert.equal(c.seen[0].auth, null);
});
