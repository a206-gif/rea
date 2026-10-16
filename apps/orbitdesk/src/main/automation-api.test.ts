import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationApiServer } from "./automation-api";

const port = 19_824;
const token = "test-token-that-is-long-enough-for-timing-safe-equality";

function fakeStore() {
  return {
    snapshot: () => ({
      settings: { automationApiEnabled: true, automationApiPort: port, automationApiToken: token },
      workspaces: [{ id: "workspace_test", name: "Dola", siteId: "dola", status: "ready", group: "默认", order: 0 }],
      tasks: [],
      storyboards: [],
    }),
    getWorkspace: () => ({ id: "workspace_test" }),
    createTasks: () => [],
    getTask: () => { throw new Error("unused"); },
    transitionTask: () => undefined,
  };
}

const running: AutomationApiServer[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((server) => server.stop())); });

describe("authenticated loopback automation API", () => {
  it("rejects unauthenticated requests and exposes only a redacted state", async () => {
    const server = new AutomationApiServer(fakeStore() as never, { open: async () => undefined } as never);
    running.push(server);
    await server.sync();

    const denied = await fetch(`http://127.0.0.1:${port}/v1/state`);
    expect(denied.status).toBe(401);

    const accepted = await fetch(`http://127.0.0.1:${port}/v1/state`, { headers: { Authorization: `Bearer ${token}` } });
    expect(accepted.status).toBe(200);
    const body = await accepted.json() as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain("localPath");
  });

  it("enforces the request Host allowlist", async () => {
    const server = new AutomationApiServer(fakeStore() as never, { open: async () => undefined } as never);
    running.push(server);
    await server.sync();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request({ hostname: "127.0.0.1", port, path: "/v1/health", headers: { Authorization: `Bearer ${token}`, Host: "attacker.invalid" } }, (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      });
      outgoing.once("error", reject);
      outgoing.end();
    });
    expect(status).toBe(400);
  });
});
