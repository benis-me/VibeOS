// Run an isolated backend (PORT=17720), then repo-root Vite (--port 17732).
// PLAYWRIGHT_MODULE=/path/to/playwright NODE_OPTIONS= node test/interactive-runtime.browser.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    `${process.env.RUNTIME_TEST_URL || "http://localhost:17732"}/test/runtime.browser.html`,
  );
  await page.waitForFunction(() => window.runtimeTest);
  await page.evaluate(() => {
    const T = window.runtimeTest;
    T.sent = [];
    T.listeners = new Map();
    T.emit = (type, payload) => {
      for (const fn of T.listeners.get(type) || []) fn(payload);
    };
    T.wsClient.on = (type, fn) => {
      const set = T.listeners.get(type) || new Set();
      set.add(fn);
      T.listeners.set(type, set);
      return () => set.delete(fn);
    };
    T.wsClient.send = (type, payload) => {
      T.sent.push({ type, payload });
      if (type === "c2s.communication.command")
        queueMicrotask(() => {
          const { windowId, requestId, command } = payload;
          if (command.action === "refresh") T.deliver("v1");
          if (command.action === "request")
            T.emit("s2c.communication.delivery", {
              delivery: {
                id: requestId,
                windowId,
                kind: "response",
                mode: "data",
                correlationId: requestId,
                data: { actual: 42 },
              },
            });
          T.emit("s2c.communication.result", { windowId, requestId });
        });
      return true;
    };
    T.deliver = (version) =>
      T.emit("s2c.communication.delivery", {
        delivery: {
          id: version,
          windowId: "runtime",
          mode: "data",
          kind: "event",
          channel: "appData",
          data: { version, data: { title: "Canonical" } },
        },
      });
    T.useConnectionStore.getState().setConnected(true);
    T.html = `<main data-vibeos-region="page" style="height:100%;display:flex;flex-direction:column;padding:20px;gap:12px">
      <style>@keyframes breathe{from{opacity:0.5}to{opacity:1}} .pulse{animation:breathe 1s infinite alternate}.pulse::after{content:"orbit";animation:breathe 1s infinite alternate}</style>
      <section data-vibeos-region="editor">
        <div role="tablist"><button role="tab" data-vibeos-local='{"action":"select","target":"views","value":"one"}'>One</button><button role="tab" data-vibeos-local='{"action":"select","target":"views","value":"two"}'>Two</button></div>
        <div data-vibeos-group="views" data-vibeos-panel="one">First</div><div data-vibeos-group="views" data-vibeos-panel="two" hidden>Second</div>
        <button data-vibeos-local='{"action":"toggle","target":"detail"}' data-vibeos-prefetch="true" data-vibeos-action="detail">Details</button><aside data-vibeos-local-id="detail" hidden>Prepared record</aside>
        <details data-vibeos-local-id="native-detail"><summary>Native details</summary><p>Native prepared content</p></details>
        <input aria-label="Filter" name="query" data-vibeos-local='{"action":"filter","target":"items"}'><ul data-vibeos-local-id="items"><li data-vibeos-item>Alpha</li><li data-vibeos-item>Beta</li></ul>
        <button data-js="increment">Local count</button><output data-count>0</output><span class="pulse" data-clock>Starting</span>
        <form data-js-form><input name="draft" aria-label="Draft"><button type="submit">Local submit</button></form>
        <button data-vibeos-action="ask-ai">Ask AI</button><button data-js="request">Read system</button><output data-result></output>
        <script type="application/vibeos" data-vibeos-script="clock">
          window.mounts=(window.mounts||0)+1;
          const deadline=vibe.state().deadline||Date.now()+60000; vibe.setState({deadline});
          window.ticks=window.ticks||0; vibe.interval(()=>{window.ticks++;root.querySelector('[data-clock]').textContent=String(window.ticks);},30);
          root.querySelector('[data-count]').textContent=String(vibe.state().count||0);
          vibe.on('click','[data-js="increment"]',()=>{const count=(vibe.state().count||0)+1;vibe.setState({count});root.querySelector('[data-count]').textContent=String(count);});
          vibe.on('submit','[data-js-form]',()=>vibe.setState({submitted:true}));
          vibe.on('click','[data-js="request"]',async()=>{const r=await vibe.command({action:'request',target:{system:'app-data'},topic:'get',responseMode:'data'});root.querySelector('[data-result]').textContent=String(r.actual);});
          return ()=>{window.cleanups=(window.cleanups||0)+1;};
        </script>
      </section><p data-vibeos-region="result">Before</p></main>`;
    T.window = {
      id: "runtime",
      appId: "app",
      appVersionId: "interactive-v1",
      runtime: "interactive",
      title: "Runtime test",
      snapshotDataVersion: "v1",
      viewState: {},
      state: "normal",
      rect: { x: 0, y: 0, w: 800, h: 540 },
      kind: "app",
      focused: true,
      isOpen: true,
      z: 1,
      order: 1,
      openedAt: 1,
      updatedAt: 1,
    };
    T.useWindowStore.getState().setAll([T.window], { runtime: T.html });
    T.root = T.createRoot(document.getElementById("fixture"));
    T.flushSync(() =>
      T.root.render(T.React.createElement(T.InteractiveSurface, { windowId: "runtime" })),
    );
    T.ops = () => T.sent.filter((x) => x.type === "c2s.op");
    T.patch = (regions) => {
      T.useWindowStore.getState().applyPatch({
        windowId: "runtime",
        mode: "regions",
        regions,
        done: true,
        dataVersion: "v1",
      });
      T.useWindowStore.getState().setBusy("runtime", false);
    };
  });
  const iframe = page.locator("iframe");
  let frame = await (await iframe.elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.ticks > 0);
  assert.equal(
    await frame.locator(".pulse").evaluate((el) => getComputedStyle(el, "::after").content),
    '"orbit"',
    "pseudo-element decoration survives CSS scoping",
  );
  assert.equal(
    await page.evaluate(() => document.querySelector("iframe").contentDocument),
    null,
    "opaque origin",
  );
  assert(
    await frame.evaluate(() => {
      try {
        parent.document.body;
        return false;
      } catch {
        return true;
      }
    }),
    "parent DOM blocked",
  );
  assert(
    await frame.evaluate(() => {
      try {
        localStorage.getItem("secret");
        return false;
      } catch {
        return true;
      }
    }),
    "host storage blocked",
  );
  assert.equal(
    await page.evaluate(
      () => window.runtimeTest.sent.filter((x) => x.type === "c2s.window.focus").length,
    ),
    0,
    "mount never steals focus",
  );
  await frame.getByRole("button", { name: "Details", exact: true }).click();
  assert(await frame.locator('[data-vibeos-local-id="detail"]').isVisible());
  await frame.locator("summary").click();
  assert(await frame.getByText("Native prepared content", { exact: true }).isVisible());
  await frame.getByRole("tab", { name: "One", exact: true }).focus();
  await frame.getByRole("tab", { name: "One", exact: true }).press("ArrowRight");
  assert(await frame.locator('[data-vibeos-panel="two"]').isVisible(), "accessible tabs");
  await frame.getByLabel("Filter").fill("Beta");
  assert.equal(await frame.locator("[data-vibeos-item]:visible").count(), 1);
  await frame.getByRole("button", { name: "Local count", exact: true }).click();
  await frame.getByLabel("Draft").fill("Unsubmitted text");
  await frame.getByRole("button", { name: "Local submit", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.runtimeTest.ops().length),
    0,
    "prepared, JS and submit interactions do not call AI",
  );
  await page.evaluate(() =>
    window.runtimeTest.useWindowStore.getState().applyPatch({
      windowId: "runtime",
      mode: "regions",
      regions: [],
      done: true,
    }),
  );
  await frame.getByRole("button", { name: "Details", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.runtimeTest.ops().length),
    0,
    "an acknowledgement without UI changes retains the prepared data revision",
  );
  await frame.getByRole("button", { name: "Read system", exact: true }).click();
  await frame.waitForFunction(() => document.querySelector("[data-result]").textContent === "42");
  await frame.getByRole("button", { name: "Ask AI", exact: true }).click();
  const op = await page.evaluate(() => window.runtimeTest.ops().at(-1).payload.op);
  assert.equal(op.viewState.count, 1);
  assert.equal(op.viewState.submitted, true);
  assert.equal(op.formData.draft, "Unsubmitted text");
  await frame.evaluate(() => (window.clockNode = document.querySelector("[data-clock]")));
  await page.evaluate(() =>
    window.runtimeTest.patch([
      { region: "result", html: '<p data-vibeos-region="result">After</p>' },
    ]),
  );
  await frame.getByText("After", { exact: true }).waitFor();
  assert(
    await frame.evaluate(
      () => window.mounts === 1 && window.clockNode === document.querySelector("[data-clock]"),
    ),
    "unaffected scripts/nodes survive patch",
  );
  assert.equal(await frame.getByLabel("Draft").inputValue(), "Unsubmitted text");
  await page.evaluate(() => {
    const T = window.runtimeTest;
    const d = document.createElement("template");
    d.innerHTML = T.html;
    T.patch([{ region: "editor", html: d.content.querySelector("section").outerHTML }]);
  });
  await frame.waitForFunction(() => window.mounts === 2);
  assert.equal(await frame.evaluate(() => window.cleanups), 1, "replaced scripts clean up once");
  assert.equal(
    await frame.locator("[data-count]").textContent(),
    "1",
    "view state survives replacement",
  );
  assert(
    await frame.getByText("Native prepared content", { exact: true }).isVisible(),
    "native disclosure survives region replacement",
  );
  await page.evaluate(() => {
    const T = window.runtimeTest;
    T.useWindowStore.getState().upsert({ ...T.window, state: "minimized" });
  });
  await page.waitForTimeout(80);
  const paused = await frame.evaluate(() => window.ticks);
  assert.equal(
    await frame
      .locator(".pulse")
      .evaluate((el) => getComputedStyle(el, "::after").animationPlayState),
    "paused",
    "pseudo-element animations pause too",
  );
  await page.waitForTimeout(120);
  assert.equal(await frame.evaluate(() => window.ticks), paused, "minimized timers pause");
  await page.evaluate(() => {
    const T = window.runtimeTest;
    T.useWindowStore.getState().upsert(T.window);
  });
  await frame.waitForFunction((n) => window.ticks > n, paused);
  await page.evaluate(() => window.runtimeTest.deliver("v2"));
  await frame.getByRole("button", { name: "Details", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.runtimeTest.ops().at(-1).payload.op.action),
    "detail",
    "stale prepared content returns to AI",
  );
  await page.evaluate(() => {
    const store = window.runtimeTest.useWindowStore.getState();
    store.applyPatch({
      windowId: "runtime",
      mode: "regions",
      regions: [],
      done: true,
      dataVersion: "v2",
    });
    store.applyPatch({ windowId: "runtime", mode: "regions", regions: [], done: true });
  });
  assert.equal(
    await page.evaluate(
      () => window.runtimeTest.useWindowStore.getState().windows.runtime.snapshotDataVersion,
    ),
    "v2",
    "reloads retain the last confirmed snapshot revision after no-op acknowledgements",
  );
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--brand", "rgb(12, 34, 56)"),
  );
  await frame.waitForFunction(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--brand").includes("12, 34, 56"),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await frame.locator(".pulse").evaluate((el) => getComputedStyle(el).animationDuration),
    "1e-05s",
    "reduced motion",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  // Error recovery is contained in the app and retains its local state.
  await frame.evaluate(() =>
    setTimeout(() => {
      throw new Error("Fixture runtime failure");
    }, 0),
  );
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: /Reload|重新加载/ }).click();
  frame = await (await iframe.elementHandle()).contentFrame();
  await frame.waitForFunction(() => window.ticks > 0);
  assert.equal(await frame.locator("[data-count]").textContent(), "1");
  await page.evaluate(() => {
    const T = window.runtimeTest;
    T.useWindowStore.getState().setBusy("runtime", false);
    T.flushSync(() =>
      T.root.render(T.React.createElement(T.AiHtmlSurface, { windowId: "runtime" })),
    );
  });
  assert.equal(await page.locator("iframe").count(), 0, "legacy mode remains outside sandbox");
  assert.equal(await page.locator(".ai-surface script").count(), 0, "legacy scripts are stripped");
  const before = await page.evaluate(() => window.runtimeTest.ops().length);
  await page.getByRole("tab", { name: "Two", exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.runtimeTest.ops().length),
    before,
    "legacy prepared controls work",
  );
  await page.evaluate(() => {
    const T = window.runtimeTest;
    T.useWindowStore
      .getState()
      .applyPatch({ windowId: "runtime", mode: "full", html: T.html, streaming: true });
    T.flushSync(() =>
      T.root.render(T.React.createElement(T.InteractiveSurface, { windowId: "runtime" })),
    );
  });
  frame = await (await page.locator("iframe").elementHandle()).contentFrame();
  await frame.locator("[data-clock]").waitFor();
  assert.equal(
    await frame.evaluate(() => window.mounts),
    undefined,
    "streaming HTML never mounts scripts even on first connection",
  );
  await page.evaluate(() => {
    const T = window.runtimeTest;
    T.useWindowStore.getState().applyPatch({
      windowId: "runtime",
      mode: "full",
      html: T.html,
      done: true,
      dataVersion: "v1",
    });
  });
  await frame.waitForFunction(() => window.ticks > 0);
  // A script may update UI, but synthetic input is never a source for system memory.
  await frame.evaluate(() => {
    const input = document.querySelector('[name="draft"]');
    input.value = "Synthetic model output";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await frame.getByRole("button", { name: "Ask AI", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.runtimeTest.ops().at(-1).payload.op.userInput))?.some(
      (x) => x.value === "Synthetic model output",
    ) ?? false,
    false,
    "only actual user input reaches memory extraction",
  );
  await frame.getByLabel("Draft").fill("Actual typed input");
  await frame.evaluate(() => {
    document.querySelector('[name="draft"]').value = "Script replacement after user typed";
  });
  await frame.getByRole("button", { name: "Ask AI", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.runtimeTest.ops().at(-1).payload.op.userInput)).find(
      (x) => x.key === "draft",
    )?.value,
    "Actual typed input",
    "memory uses captured user text, not a script's later replacement",
  );
  await page.evaluate(() => window.runtimeTest.flushSync(() => window.runtimeTest.root.unmount()));
  console.log(
    "PASS: prepared interactions, stale fallback, zero-call local JS, state/drafts, region lifecycle, real bridge responses, isolation, motion/theme, minimization, recovery and classic compatibility",
  );
} finally {
  await browser.close();
}
