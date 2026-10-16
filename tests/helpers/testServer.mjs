// Spawns the real backend (node index.js) against a LOCAL test database.
// Never point this at a shared database: resetDb() drops it.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const TEST_MONGO_URI = process.env.TEST_MONGO_URI || "mongodb://localhost:27017/nuformly_test";
export const TEST_JWT_SECRET = "test-secret";

export function assertLocalMongo(uri = TEST_MONGO_URI) {
  const host = new URL(uri).hostname;
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
    throw new Error(`Refusing to run tests against non-local MongoDB host "${host}".`);
  }
}

export async function startTestServer({ port = 4199 } = {}) {
  assertLocalMongo();
  const env = {
    ...process.env,
    MONGO_URI: TEST_MONGO_URI,
    JWT_SECRET: TEST_JWT_SECRET,
    PORT: String(port),
    ADMIN_ALLOWED_ORIGINS: "http://admin.test",
    // Every Groq key is set explicitly so dotenv can't fill real ones in
    // from .env — tests must never make paid AI calls.
    GROQ_API_KEY_1: "test",
    GROQ_API_KEY_2: "test",
    GROQ_API_KEY_3: "test",
    GROQ_API_KEY_4: "test",
    GROQ_API_KEY_5: "test",
  };
  const child = spawn(process.execPath, ["index.js"], { cwd: BACKEND_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  const baseUrl = `http://localhost:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.status === 200) break;
    } catch {}
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`Test server did not become healthy:\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return {
    baseUrl,
    async stop() {
      child.kill();
      await new Promise((r) => child.once("exit", r));
    },
  };
}
