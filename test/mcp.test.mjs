import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../mcp/index.mjs", import.meta.url));

// one JSON-RPC round trip: write a line, resolve the response with the same id
function call(child, msg) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let got; try { got = JSON.parse(line); } catch (e) { continue; }
        if (got.id === msg.id) { child.stdout.off("data", onData); resolve(got); return; }
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(JSON.stringify(msg) + "\n");
    setTimeout(() => { child.stdout.off("data", onData); reject(new Error("timeout")); }, 5000);
  });
}

test("MCP: initialize, list the five tools, and report an unknown tool as an error", async () => {
  const child = spawn(process.execPath, [server], { stdio: ["pipe", "pipe", "inherit"] });
  try {
    const init = await call(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    assert.equal(init.result.serverInfo.name, "ipqs");
    assert.equal(init.result.protocolVersion, "2024-11-05");
    const list = await call(child, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assert.deepEqual(list.result.tools.map(t => t.name), ["check_ip", "check_self", "explain_score", "resolve_host", "batch_check"]);
    const bad = await call(child, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope", arguments: {} } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /unknown tool/);
  } finally {
    child.kill();
  }
});
