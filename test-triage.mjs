import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const PORT = 3456;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL(".", import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(body, { raw } = {}) {
  const response = await fetch(`${BASE}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const response = await fetch(BASE);
      if (response.ok) return;
    } catch {
      // retry until the server is ready
    }
    await delay(50);
  }
  throw new Error("Server did not start in time");
}

const server = spawn(process.execPath, ["server.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});

let failed = false;

try {
  await waitForServer();

  const timeoutCase = await request({ text: "Нужна помощь [timeout]" });
  assert(timeoutCase.status === 200, `timeout: expected HTTP 200, got ${timeoutCase.status}`);
  assert(
    timeoutCase.body.status === "manual_review",
    `timeout: expected manual_review, got ${timeoutCase.body.status}`,
  );
  assert(timeoutCase.body.topic === null, "timeout: topic must be null");
  assert(timeoutCase.body.draft === null, "timeout: draft must be null");

  const errorCase = await request({ text: "Проблема [error]" });
  assert(errorCase.status === 200, `error: expected HTTP 200, got ${errorCase.status}`);
  assert(errorCase.body.status === "manual_review", "error: expected manual_review");

  const badJsonCase = await request({ text: "Текст [bad-json]" });
  assert(badJsonCase.body.status === "manual_review", "bad-json: expected manual_review");

  const badTopicCase = await request({ text: "Текст [bad-topic]" });
  assert(badTopicCase.body.status === "manual_review", "bad-topic: expected manual_review");

  const emptyDraftCase = await request({ text: "Текст [empty-draft]" });
  assert(emptyDraftCase.body.status === "manual_review", "empty-draft: expected manual_review");

  const invalidInput = await request({ text: "   " });
  assert(invalidInput.status === 400, `invalid: expected HTTP 400, got ${invalidInput.status}`);
  assert(invalidInput.body.status === "invalid_input", "invalid: expected invalid_input");

  const readyCase = await request({ text: "Когда будет доставка заказа?" });
  assert(readyCase.status === 200, `ready: expected HTTP 200, got ${readyCase.status}`);
  assert(readyCase.body.status === "ready", "ready: expected ready");
  assert(readyCase.body.topic === "delivery", `ready: expected delivery, got ${readyCase.body.topic}`);
  assert(typeof readyCase.body.draft === "string" && readyCase.body.draft.trim(), "ready: draft required");

  console.log("All triage tests passed.");
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
} finally {
  server.kill("SIGTERM");
}

process.exit(failed ? 1 : 0);
