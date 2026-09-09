import { afterAll, beforeAll, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { AI_PROVIDERS } from "@vibeos/shared/domain";
import { migrate } from "../../db/migrate.ts";
import { getDb } from "../../db/database.ts";
import { ensureSettings, updateSettings } from "../../db/repositories/SettingsRepo.ts";
import { availableProviderIds, getProvider } from "./index.ts";
import { providerConfig } from "./config.ts";
import { inferCapabilities } from "../modelDiscovery.ts";

const ids = ["minimax", "zhipu", "kimi", "cerebras"] as const;
const keys = ["MINIMAX_API_KEY", "ZHIPU_API_KEY", "MOONSHOT_API_KEY", "CEREBRAS_API_KEY"];
const requests: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];
const html = '<vibeos-html mode="full"><div>Ready</div></vibeos-html>';
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/models")) {
      return Response.json({
        data: [{ id: "custom-model", name: "Custom model" }, null, { id: 42 }],
      });
    }
    const body = (await req.json()) as Record<string, unknown>;
    requests.push({ path, auth: req.headers.get("authorization"), body });
    if (body.model === "denied") {
      return Response.json(
        { error: { message: "Invalid test key", type: "auth_error" } },
        { status: 401 },
      );
    }
    const events = [
      {
        choices: [
          {
            index: 0,
            delta: {
              reasoning_content: "Private reasoning",
              reasoning_details: [{ text: "Private reasoning" }],
            },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ index: 0, delta: { content: html.slice(0, 25) }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: html.slice(25) }, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 11, completion_tokens: 23, total_tokens: 34 } },
    ];
    return new Response(
      `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`,
      {
        headers: { "Content-Type": "text/event-stream" },
      },
    );
  },
});

beforeAll(async () => {
  migrate(getDb());
  await ensureSettings();
});
afterAll(() => server.stop(true));

test("all four API providers persist, discover models and stream through their own credentials", async () => {
  for (const [i, id] of ids.entries()) {
    const catalog = AI_PROVIDERS.find((p) => p.id === id)!;
    for (const model of catalog.seedModels!) {
      expect(inferCapabilities(model.id)).toEqual(model.capabilities!);
    }
    const envKey = keys[i]!;
    const previous = process.env[envKey];
    try {
      process.env[envKey] = `env-${id}`;
      expect(providerConfig(id).apiKey).toBe(`env-${id}`);
      expect(providerConfig(id).baseUrl).toBe(catalog.defaultBaseUrl!);
      await updateSettings({
        provider: id,
        apiProviders: { [id]: { apiKey: `saved-${id}`, baseUrl: `${server.url}${id}/v1///` } },
      });
      expect(availableProviderIds()).toContain(id);
      // A fresh process checks DB hydration and the environment provider whitelist.
      const reloaded = Bun.spawnSync(
        [
          process.execPath,
          "--eval",
          `
        import { loadSettings } from './apps/backend/src/db/repositories/SettingsRepo.ts';
        import { env } from './apps/backend/src/config/env.ts';
        console.log(JSON.stringify([loadSettings().provider, env.aiProvider]));
      `,
        ],
        {
          cwd: fileURLToPath(new URL("../../../../../", import.meta.url)),
          env: { ...process.env, NODE_OPTIONS: "", VIBEOS_AI_PROVIDER: id },
        },
      );
      expect(reloaded.exitCode).toBe(0);
      expect(JSON.parse(reloaded.stdout.toString().trim())).toEqual([id, id]);

      const provider = await getProvider(id);
      expect(provider.id).toBe(id);
      expect(await provider.discoverModels()).toEqual(
        catalog.modelsEndpoint
          ? [{ modelId: "custom-model", name: "Custom model" }]
          : catalog.seedModels!.map((m) => ({ modelId: m.id, name: m.name })),
      );
      const deltas: string[] = [];
      const result = await provider.run({
        systemPrompt: "System instruction",
        prompt: "Generate a window",
        thinking: { type: "disabled" },
        onDelta: (delta) => deltas.push(delta),
      });
      expect(result).toMatchObject({
        text: html,
        ok: true,
        usage: { inputTokens: 11, outputTokens: 23 },
      });
      expect(deltas.join("")).toBe(html);
      const request = requests.at(-1)!;
      expect(request.path).toBe(`/${id}/v1/chat/completions`);
      expect(request.auth).toBe(`Bearer saved-${id}`);
      expect(request.body).toMatchObject({
        model: catalog.seedModels![0]!.id,
        stream: true,
        messages: [
          { role: "system", content: "System instruction" },
          { role: "user", content: "Generate a window" },
        ],
      });
      if (id === "minimax")
        expect(request.body).toMatchObject({
          reasoning_split: true,
          thinking: { type: "disabled" },
        });
      else expect(request.body.reasoning_effort).toBe("low");
      expect(request.body).not.toHaveProperty("temperature");

      // The registry caches providers; saving credentials must still take effect immediately.
      await updateSettings({
        apiProviders: { [id]: { apiKey: `changed-${id}`, baseUrl: `${server.url}${id}/changed` } },
      });
      expect((await provider.run({ systemPrompt: "s", prompt: "p", model: "custom-id" })).ok).toBe(
        true,
      );
      expect(requests.at(-1)).toMatchObject({
        path: `/${id}/changed/chat/completions`,
        auth: `Bearer changed-${id}`,
        body: { model: "custom-id" },
      });
    } finally {
      if (previous === undefined) delete process.env[envKey];
      else process.env[envKey] = previous;
    }
  }
});

test("compatible requests honor model-specific thinking options and propagate failure / abort", async () => {
  const cases = [
    { id: "minimax", model: "MiniMax-M2.7", expected: { reasoning_split: true } },
    { id: "zhipu", model: "glm-5.2", expected: { thinking: { type: "enabled" } } },
    { id: "zhipu", model: "glm-5.3-flash", expected: { reasoning_effort: "max" } },
    { id: "kimi", model: "kimi-k3", expected: { reasoning_effort: "max" } },
    { id: "kimi", model: "kimi-k2.6", expected: { thinking: { type: "enabled" } } },
    {
      id: "cerebras",
      model: "qwen-3.8-27b",
      expected: { reasoning_format: "parsed", reasoning_effort: "high" },
    },
  ] as const;
  for (const { id, model, expected } of cases) {
    await updateSettings({
      apiProviders: { [id]: { apiKey: `test-${id}`, baseUrl: `${server.url}${id}/v1` } },
    });
    const provider = await getProvider(id);
    await provider.run({
      systemPrompt: "s",
      prompt: "p",
      model,
      thinking: { type: "adaptive" },
      effort: "xhigh",
    });
    expect(requests.at(-1)!.body).toMatchObject(expected);
  }
  const provider = await getProvider("cerebras");
  await provider.run({
    systemPrompt: "s",
    prompt: "p",
    model: "qwen-3.8-27b",
    thinking: { type: "disabled" },
  });
  expect(requests.at(-1)!.body.reasoning_effort).toBe("none");
  expect(await provider.run({ systemPrompt: "s", prompt: "p", model: "denied" })).toMatchObject({
    ok: false,
    error: "Invalid test key",
  });
  const abort = new AbortController();
  const result = await provider.run({
    systemPrompt: "s",
    prompt: "p",
    abort,
    onDelta: () => abort.abort(),
  });
  expect(result.ok).toBe(false);
});
