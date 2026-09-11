import { fileURLToPath } from "node:url";

let bundle: Promise<string> | undefined;
/** One browser bundle per backend process. No vendor runtime or external dependency. */
export async function serveRuntimeBundle() {
  bundle ??= Bun.build({
    entrypoints: [
      fileURLToPath(
        new URL("../../../frontend/src/runtime/frame.ts", import.meta.url),
      ),
    ],
    target: "browser",
    format: "iife",
    minify: true,
  })
    .then(async (result) => {
      if (!result.success) throw new Error(result.logs.map(String).join("\n"));
      return result.outputs[0]!.text();
    })
    .catch((error) => {
      bundle = undefined;
      throw error;
    });
  return new Response(await bundle, {
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
