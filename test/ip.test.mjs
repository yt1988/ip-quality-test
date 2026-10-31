import { test } from "node:test";
import assert from "node:assert/strict";
import { family, canon, isPublic, reverse } from "../src/ip.mjs";

test("family", () => {
  assert.equal(family("1.2.3.4"), 4);
  assert.equal(family("256.1.1.1"), 0);
  assert.equal(family("01.2.3.4"), 0);
  assert.equal(family("2001:db8::1"), 6);
  assert.equal(family("::ffff:1.2.3.4"), 6);
  assert.equal(family("1:2:3:4:5:6:7:8"), 6);
  assert.equal(family("1:2:3:4:5:6:7:8:9"), 0);
  assert.equal(family("1::2::3"), 0);
  assert.equal(family("example.com"), 0);
  assert.equal(family("1.2.3.4:80"), 0);
});

test("canon shortens IPv6 the RFC 5952 way", () => {
  assert.equal(canon("2001:0DB8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
  assert.equal(canon("2001:db8:0:1:0:0:0:1"), "2001:db8:0:1::1");
  assert.equal(canon("2001:4860:4860:0:0:0:0:8888"), "2001:4860:4860::8888");
  assert.equal(canon("  8.8.8.8 "), "8.8.8.8");
  assert.equal(canon("nope"), "");
});

test("isPublic", () => {
  for (const ip of ["10.1.1.1", "192.168.0.1", "172.16.5.5", "100.64.0.1", "127.0.0.1", "169.254.1.1", "224.0.0.1", "192.0.2.1", "fe80::1", "::1", "fc00::1", "2001:db8::1", "2002::1"])
    assert.equal(isPublic(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2001:4860:4860::8888", "2400:cb00::1"]) assert.equal(isPublic(ip), true, ip);
});

test("reverse for DNS blocklists", () => {
  assert.equal(reverse("1.2.3.4"), "4.3.2.1");
  assert.equal(reverse("2001:db8::1").split(".").length, 32);
  assert.ok(reverse("2001:db8::1").startsWith("1.0.0.0."));
});
