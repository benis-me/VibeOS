import {
  SKIN_TOKENS,
  SKIN_TARGETS,
  SKIN_PROPERTIES,
  skinOutputSchema,
  isBuiltinSkin,
  type Skin,
  type SkinCommand,
  type SkinRequest,
  type SkinDefinition,
  type SkinRecord,
} from "@vibeos/shared/domain";
import * as SdkManager from "./SdkManager.ts";
import * as SkinRepo from "../db/repositories/SkinRepo.ts";
import { loadSettings } from "../db/repositories/SettingsRepo.ts";
import { requestSkinImage } from "./imageCache.ts";
import { hasImage } from "../db/repositories/ImagesRepo.ts";
import { createNode } from "../db/repositories/VfsRepo.ts";
import { broadcast } from "../server/wsGateway.ts";

const jobs = new Map<string, { abort: AbortController; request?: SkinRequest }>();
const systemPrompt = `You are the art director and implementer of VibeOS skins using our OWN SkinDefinition v1 contract. Deliver a complete, distinctive desktop skin, crafted to the user's actual brief. Return only JSON: {"summary":"one short sentence describing the visible appearance only, never JSON, CSS syntax, validation errors, retries or implementation details","definition":{"format":1,"intent":"durable visual brief","light":{},"dark":{},"chrome":{},"assets":{},"rules":[]}}.

DESIGN STANDARD
Before writing JSON, decide the visual language: silhouette and proportions, real material and light direction, typography, ornament placement, palette, and interaction behavior. Encode those decisions in the actual rules. A recolor plus a large shadow is not a designed skin. More refined does NOT mean more random gradients, blur everywhere, or a longer summary.
QUIET CHROME IS A HARD REQUIREMENT. Titlebars and the taskbar are narrow surfaces behind small text: use smooth color, gentle light falloff, hairline edges and at most faint microtexture. No all-over filigree, repeated runes, tapestry patterns, checkerboards or high-contrast motifs on these bars. Concentrate recognizable ornament on window edges and the desktop instead. A complex theme still needs calm text backgrounds. The title and every running-app label must be readable at a glance. Aim for 4.5:1 text contrast, including inactive titles and tray text. Material on bars should be almost imperceptible at normal viewing size (opacity 0.03–0.08).
The built-ins reach this standard through specific craft: XP has a narrow highlight band, dark lower edge, nested frame strokes, raised beveled controls, separate pressed states and a muted inactive frame; Aqua has fine scanline material, carefully graduated gloss, inset highlights, sculpted controls, a floating dock and distinct inactive chrome. Match this depth of craft while choosing a DIFFERENT language when the brief calls for one. Do not clone their palette or geometry by default.
For a named world/theme, use its recognizable materials, motifs, typography and composition (e.g. arcane engraved metal, manuscript ornament, industrial instrument panel), rather than merely picking its brand colors. Place expressive detail on chrome and the desktop; keep text fields and app reading surfaces calm, legible and usable. A skin should be recognizable with any app open, not just by its wallpaper.
Design the whole family: desktop composition; framed windows and titlebars; close/minimize/maximize controls; taskbar, selected task and start menu; menus, buttons, inputs and address bars. Include deliberate hover, active, visible focus, and inactive window states. Use layered material where justified, not identical effects on every surface. Design BOTH light and dark modes as the same identity with readable foreground/background pairs. Explicit user constraints take precedence in both modes: keep light reading surfaces light, or an explicitly dark skin dark, unless the user asks for separate variants.
Preserve the original intent and constraints through follow-up edits. The current selected version is authoritative after a rollback. Update intent as a concise cumulative brief; retain details the latest request did not revoke. Do not assume that "more detailed" changes the requested theme. Blank skins have no built-in foundation. A duplicate may override all its packaged foundation's appearance but cannot modify the original.

CONTRACT
Token keys (without --): ${SKIN_TOKENS.join(", ")}. Every token except radius, taskbar-h, font-sans and font-title MUST be a CSS COLOR, never a gradient or image. Those color tokens are also used in background-color and color-mix. Put gradients/images in rule background or background-image instead. radius: 0–32px, taskbar-h: 28–72px (chrome calculates its reserved space when supplied). Use hex/rgb/oklch and var(--token); define paired foregrounds whenever changing a background.
Fonts bundled: "Geist Variable", "JetBrains Mono Variable". System alternatives: Georgia, Times New Roman, Palatino, Courier New, Arial, Trebuchet MS; for Chinese use Songti SC/serif or PingFang SC/sans-serif. Use a working system fallback. Never invent a font or assume franchise/web fonts are installed. Use font-title for the shared window title, taskbar app names and start button family; font-sans for readable body text. These should form one intentional type system. Do not change only the title rule and forget task names.
Optional chrome (all sizes in px): {titlebarHeight:28..56,controlSize:16..32,controlGap:2..12,controlsSide:"left"|"right",titleAlign:"left"|"center",taskbarStyle:"bar"|"dock",taskbarHeight:36..64,taskbarInset:0..16,taskSize:28..52}. Controls/tasks must be at least 4px smaller than their bar height. Choose proportions for the design instead of copying these defaults. This changes only chrome geometry, never app layout or window coordinates.
Rules: {"target":"titlebar","state":"default","mode":"both","styles":{"background":"linear-gradient(to bottom, #24404c, #14252d)","box-shadow":"inset 0 1px 0 #a0b5b2"}}. Targets: ${Object.keys(SKIN_TARGETS).join(", ")}. States: default, hover, active, focus, disabled, unfocused (window or its descendants). Modes: both, light, dark. Properties: ${SKIN_PROPERTIES.join(", ")}. font-size: 10–24px. Multiple backgrounds are supported with matching comma-separated size/position/repeat. CSS FIRST background is the TOP layer: never place an opaque normal-blend gradient in front of an image because it hides the entire texture. For materials use asset FIRST with soft-light/multiply/screen (chosen for the desired material) over a solid color or gradient. Border-image supports image or gradient frames with slice/width/repeat. Use borders and inset shading intentionally; opaque windowBody hides the window background behind it.
Safe functions: var, rgb/rgba, hsl/hsla, oklch/oklab, color-mix, linear-gradient, radial-gradient, repeating-linear-gradient, repeating-radial-gradient, conic-gradient, blur, saturate, asset. No calc/min/max/clamp. No selectors, arbitrary properties/variables, layout declarations, visibility, URLs, at-rules, !important, escapes, JavaScript, HTML, syscalls or emoji. Return the complete definition, not a diff.

IMAGE MATERIALS
The request states whether an image model is available. If available, generate images when they add real craft: a composed desktop illustration, engraved ornament, a seamless woven/paper/stone/metal texture, or a decorative frame. For a user explicitly requesting images, use this capability. Do not settle for CSS stripes as a substitute for an illustrative or material brief. For a crisp flat/minimal brief, images may be unnecessary. Reuse unchanged assets across refinements.
Declare assets by name: "assets":{"wallpaper":{"prompt":"Detailed standalone art direction…","aspect":"16:9"},"grain":{"prompt":"Seamless subtle handmade paper surface, flat even lighting, edge-to-edge, no text, no objects…","aspect":"1:1"}}. Allowed aspect values: 1:1,16:9,9:16,4:3,3:4. Server generates and saves the images before the skin becomes active. Existing assets may retain their id ONLY if prompt/aspect are unchanged; omit id for new or changed art. Never invent an id or URL.
Reference with asset(name) in background/background-image/border-image-source ONLY. Example titlebar: {"background-image":"linear-gradient(to bottom, rgb(255 255 255 / 0.12), rgb(0 0 0 / 0.08)), asset(grain)","background-size":"100% 100%, 320px 320px","background-repeat":"no-repeat, repeat","background-blend-mode":"normal, soft-light"}. For desktop use cover/center with a low-detail area behind windows, carefully matched colors and sufficient contrast for icons. Repeated textures need tileable prompts; frame art needs flat orthographic border-only composition and correct slice values. Do not generate screenshots of an OS, fake buttons/text or UI layouts inside images. Controls/text are real UI styled by rules. Use image prompts that specify material, palette, scale, composition and lighting, not just a theme name.
For a faint material, use a rule's optional material field: {"target":"titlebar","styles":{"background":"linear-gradient(#172924, #12221c)","color":"#eef1e9"},"material":{"asset":"grain","size":"256px 256px","opacity":0.06,"blend":"normal"}}. The engine paints it behind text and hit targets. Material targets: window, titlebar, taskbar, desktop, windowBody. Titlebar/taskbar/windowBody material opacity may not exceed 0.12. Use material for all titlebar/taskbar image textures, NEVER asset() in their background styles. Desktop and window-frame art may use ordinary asset() backgrounds/border images. Material on text-bearing bars needs a subtle original micrograin prompt with low contrast, even lighting and no recognizable motifs, not the decorative image used for wallpaper or frames. Generate ONLY images that are actually referenced. If images are unavailable, retain existing assets and design using CSS; do not request new images.`;

export function broadcastSkins(): void {
  broadcast("s2c.skin.state", SkinRepo.skinState());
  broadcast("s2c.settings.changed", { settings: loadSettings() });
}
export async function handleSkinCommand(command: SkinCommand): Promise<Skin> {
  let id: Skin;
  if (command.action === "import") id = await SkinRepo.importSkin(command.json);
  else if (command.action === "create")
    id = await SkinRepo.createSkin(command.name, command.sourceId as Skin | undefined);
  else {
    id = command.id as Skin;
    switch (command.action) {
      case "export": {
        const current = SkinRepo.getSkin(id);
        const node = await createNode({
          name: `${current.name}.vibeskin`,
          type: "file",
          mime: "application/vibeskin+json",
          content: SkinRepo.exportSkin(id),
          location: "desktop",
        });
        broadcast("s2c.syscall.fileCreated", { node });
        broadcast("s2c.files.changed", {});
        break;
      }
      case "rename":
        await SkinRepo.renameSkin(id, command.name);
        break;
      case "activate":
        await SkinRepo.activateSkin(id, command.versionId);
        break;
      case "delete":
        if (isBuiltinSkin(id)) throw new Error("skins.error.readonly");
        await cancelSkin(id);
        await SkinRepo.deleteSkin(id);
        id = loadSettings().skin ?? "devdock";
        break;
      case "cancel":
        await cancelSkin(id);
        break;
      case "generate": {
        if (isBuiltinSkin(id)) throw new Error("skins.error.readonly");
        if (jobs.has(id)) throw new Error("skins.error.busy");
        const job = { abort: new AbortController() } as {
          abort: AbortController;
          request?: SkinRequest;
        };
        jobs.set(id, job);
        try {
          job.request = await SkinRepo.startSkinRequest(id, command.prompt);
          const current = SkinRepo.getSkin(id);
          // The task belongs to the skin, never to its window or originating socket.
          void generate(job, SkinRepo.skinRequestDefinition(job.request), current).finally(() => {
            if (jobs.get(id) === job) jobs.delete(id);
          });
        } catch (error) {
          if (job.request)
            await SkinRepo.updateSkinRequest(
              job.request.id,
              "failed",
              0,
              error instanceof Error ? error.message : String(error),
            );
          jobs.delete(id);
          throw error;
        }
        break;
      }
    }
  }
  broadcastSkins();
  return id;
}
async function cancelSkin(id: Skin): Promise<void> {
  if (isBuiltinSkin(id)) throw new Error("skins.error.readonly");
  const job = jobs.get(id);
  job?.abort.abort();
  if (job?.request)
    await SkinRepo.updateSkinRequest(job.request.id, "cancelled", job.request.chars);
  if (jobs.get(id) === job) jobs.delete(id);
}
async function generate(
  job: { abort: AbortController; request?: SkinRequest },
  definition: SkinDefinition,
  current: SkinRecord,
): Promise<void> {
  const request = job.request!;
  let chars = 0,
    lastProgress = 0;
  const progress = async (status: "generating" | "refining" | "validating" | "assets") => {
    const updated = await SkinRepo.updateSkinRequest(request.id, status, chars);
    if (updated) {
      job.request = updated;
      broadcast("s2c.skin.progress", { request: updated });
    }
  };
  const imageModel = loadSettings().prefs.imageModel;
  const ancestors: string[] = [];
  let base = request.baseVersionId;
  const byVersion = new Map(
    current.requests.filter((r) => r.versionId).map((r) => [r.versionId, r]),
  );
  while (base && byVersion.has(base)) {
    const ancestor = byVersion.get(base)!;
    ancestors.unshift(ancestor.prompt);
    byVersion.delete(base);
    base = ancestor.baseVersionId;
  }
  let prompt = `[VIBEOS_SKIN_REQUEST]\nSkin: ${current.name}\nPackaged foundation: ${current.foundation ?? "none"}\nImage generation: ${imageModel?.provider && imageModel.model ? "available" : "unavailable"}\nREQUESTS LEADING TO THE SELECTED VERSION:\n${ancestors.join("\n---\n")}\nCURRENT definition:\n${JSON.stringify(definition)}\nUSER REQUEST:\n${request.prompt}`;
  try {
    let output!: { summary: string; definition: SkinDefinition };
    let runId: string | undefined;
    const brief = prompt;
    for (const phase of ["generating", "refining"] as const) {
      for (let attempt = 0; attempt < 2; attempt++) {
        job.abort.signal.throwIfAborted();
        await progress(phase);
        const result = await SdkManager.run({
          role: "ui-generation",
          trigger: "user",
          appName: "Skins",
          prompt,
          systemPromptOverride: systemPrompt,
          abort: job.abort,
          onDelta: (delta) => {
            chars += delta.length;
            if (Date.now() - lastProgress > 400) {
              lastProgress = Date.now();
              void progress(phase).catch(() => {});
            }
          },
        });
        job.abort.signal.throwIfAborted();
        if (!result.ok) throw new Error(result.error || "skins.error.generation");
        await progress("validating");
        runId = result.runId;
        try {
          const text = result.text
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, "");
          output = skinOutputSchema.parse(JSON.parse(text));
          for (const [name, asset] of Object.entries(output.definition.assets ?? {})) {
            const prior = definition.assets?.[name];
            if (
              asset.id &&
              (asset.id !== prior?.id ||
                asset.prompt !== prior.prompt ||
                asset.aspect !== prior.aspect)
            )
              throw new Error(
                `Asset ${name}: only unchanged existing images may keep their id. Omit id for new art.`,
              );
            if ((!asset.id || !hasImage(asset.id)) && (!imageModel?.provider || !imageModel.model))
              throw new Error(
                "No image model configured. Keep existing images or use CSS materials.",
              );
          }
          if (
            !Object.keys(output.definition.light).length &&
            !Object.keys(output.definition.dark).length &&
            !output.definition.rules.some((rule) => Object.keys(rule.styles).length)
          )
            throw new Error("The generated skin is empty. Provide a complete visual design.");
        } catch (error) {
          if (attempt === 1 || job.abort.signal.aborted) throw error;
          prompt += `\nYour output could not be validated. Correct it and return the complete JSON. Keep the summary about visible design only; do not mention this validation repair.\nERROR: ${String(error).slice(0, 4000)}\nINVALID OUTPUT:\n${result.text.slice(0, 48000)}`;
          continue;
        }
        break;
      }
      if (phase === "generating") {
        prompt = `${brief}\n\n[CRAFT REVIEW]\nThis is a first draft, not the finished skin. Inspect it critically against the user's brief and selected version. Return a revised COMPLETE JSON in the same contract. Keep one coherent identity; fix missing details instead of simply piling on effects. Would the windows still communicate this theme if the wallpaper were hidden? A generic flat titlebar with a single border fails a richly themed brief. Improve material light/shadow, signature ornament, edge treatment, control proportions and distinct interaction states. Use the initial design pass as a complete v1, not an invitation for the user to ask twice more. Review the whole family of controls and both color modes. Any material on titlebars/taskbar MUST use the dedicated material layer at opacity 0.03–0.08 and remain quiet behind text; never blanket these bars with engraved motifs or strong texture. Put distinctive ornament on window edges or desktop art. Ensure running-app labels use the same title typography and tray text stays readable. If illustration/material benefits this specific brief, use it where it belongs; do not add images merely to check a box. Ensure new assets are referenced by actual rules and composed at an intentional scale; keep reading areas quiet. If the brief requests minimalism, refine alignment, proportions and contrast instead of adding ornament. Preserve the exact user's theme and previous constraints, avoid unrequested changes. Check that material images actually show: CSS first layer is top, so an opaque normal-blend gradient covering the asset makes it invisible. Put the image first with a suitable blend or use translucent overlays. Check all values against the contract, and keep the summary to one factual short sentence.\nFIRST DRAFT:\n${JSON.stringify(output)}`;
      }
    }
    for (const asset of Object.values(output.definition.assets ?? {})) {
      if (asset.id && hasImage(asset.id)) continue;
      await progress("assets");
      try {
        asset.id = await requestSkinImage(
          imageModel!.provider!,
          imageModel!.model!,
          asset.prompt,
          asset.aspect,
          job.abort.signal,
        );
      } catch (error) {
        if (job.abort.signal.aborted) throw error;
        throw new Error("skins.error.images", { cause: error });
      }
    }
    job.abort.signal.throwIfAborted();
    await progress("validating");
    const published = await SkinRepo.publishSkinVersion(
      request.id,
      output.definition,
      output.summary,
      job.abort.signal,
    );
    if (published) await SdkManager.recordSummary(runId, output.summary);
  } catch (error) {
    await SkinRepo.updateSkinRequest(
      request.id,
      job.abort.signal.aborted ? "cancelled" : "failed",
      chars,
      job.abort.signal.aborted ? "" : error instanceof Error ? error.message : String(error),
    );
  } finally {
    broadcastSkins();
    broadcast("s2c.files.changed", {});
  }
}
