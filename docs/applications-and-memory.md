# Local applications and system memory

VibeOS remains an AI-hallucination-driven operating system. Application bundles
retain an experience's intent, starting interface, resources and versions.
Clicks and semantic messages still invoke the model, using the existing full or
region rendering path. Generated JavaScript is never executed.

## Applications

The native Applications app replaces the former template store. It creates,
renames, duplicates and uninstalls local applications, generates changes in a
conversation, selects an active version, and imports/exports `.vibeapp` files.
There is no publication workflow or new application permission system.

- A temporary generated experience has its own app ID. Saving it promotes that
  identity and retains its windows and shared data.
- An application generation request belongs to the app. Closing Applications
  does not cancel it. Only successfully validated output creates a version and
  activates it. Cancel, failure and restart preserve the previous version.
- A request starts from the selected version and retains its instructions.
  Existing windows keep their version. **Open current version** opens alongside
  an older window, preserving its unsaved fields.
- Duplicate creates an independent app with empty shared data. Legacy snapshots
  can contain personal records, so their duplicates regenerate a fresh interface.
- Versions change application definitions, not user data. Incompatible data schema
  changes require a complete migration with a matching data revision and a backup.
  Selecting an incompatible old version is rejected instead of damaging data.

```
~/.vibeos/
  runtime/vibeos.db                       indexes, windows, requests, settings
  runtime/backups/<timestamp>/           original database and disk before migration
  disk/Applications/<name>--<id>.vibeapp/
    manifest.json                        identity and active entry
    Versions/<version-id>/
      definition.json                    intent, file types, operations, geometry
      index.html                         reusable initial interface
      assets.json
      Assets/                            referenced raster bytes
  disk/Cache/Applications/                temporary experiences
  disk/System/AppData/<app-id>/state.json shared data, independently of UI versions
  disk/System/AppData/<app-id>/Backups/   data before clearing/schema changes
  disk/System/Sessions/<window-id>/       window snapshots
  disk/System/LegacyApplications/         preserved old package directories
  disk/System/Memory/memories.json        saved user memories
```

Startup storage migration v3 backs up before SQL changes, preserves window IDs,
shortcuts, geometry and exact snapshots, materializes versioned bundles, and gives
old temporary windows separate identities. Subsequent boots reuse the migration.
Original app records embedded in old HTML remain intact. When shared data is empty,
the next interaction instructs AI to retain all visible records and stable IDs in
shared state before applying changes or opening related windows.

## Shared data and real file processing

Ordinary generated interactions include one `app-state` syscall: `{type:"app-state",
data:<complete updated JSON>}` for changed records, or `{type:"app-state"}` to keep
them unchanged. The runtime supplies the captured revision and commits before
other syscalls or final UI publication, so ordinary changes need no extra model
read/write turns. Conflicts preserve the newer records and the previous UI.
The low-level `communication` requests to `{"system":"app-data"}` still use `get` and `set`.
`get` returns `{appId,version,schemaVersion,data}` for the sending application.
`set` takes `{version,data}` and rejects stale writes. Read, reconcile and retry
on a conflict. The source app ID comes from the window runtime.

`data-vibeos-bind="appData.data.someField"` receives text updates across that
application's windows without calling the model. Other open generated views also
receive `app.data.changed` automatically for semantic AI updates, without clicking
notifications. Explicit subscriptions to that topic with `source:{"appId":"self"}`
override the default: use `mode:"data"` when bindings alone suffice. Unchanged
writes do not create revisions or refreshes. Window selection and unsaved edits
remain local. Spawned windows retain their opener, purpose, record context and
same-app version. Optional `close` with no windowId dismisses the current window;
completing a business action does not inherently close it. A newly opened
window with shared data invokes AI to populate the reusable interface.

Definitions declare `fileTypes` (extensions or MIME patterns) and `operations`
(topic plus description). Files' **Open with** lists suitable generated apps.
For `file.open`, the model receives a real disk path, requests the actual bytes
from Files, interprets them, writes through the file service and replies only
after confirmation. Read/write continuations retain the complete initiating
user input; abbreviated interaction summaries never substitute for form values.
Requests use the existing cancellation, timeout and FIFO communication semantics.
Closing a processing window cancels its communication; app definition generation
is separately owned by the application.

Files recognizes bundle folders as applications. Open launches a registered
bundle or imports a copy. Show package contents browses it. The context menu
provides AI edit, duplicate, export and uninstall. Moving a registered bundle
updates its indexes; Trash uninstalls it and restoring reinstates the same
identity and data, together with its existing desktop shortcuts. Published files inside bundles are immutable; edit through
version generation. Application shortcuts remain passive references.

Portable `.vibeapp` v2 files contain the selected definition and raster bytes.
Imports validate content before writing, remap image IDs and create a new app ID.
Old v1 exports are accepted. Export excludes shared data unless **Include app data** is selected; legacy snapshot HTML is likewise omitted by default.
Settings, API credentials, system memory files, window history and other versions
are not packaged. Text explicitly authored into a reusable app definition is part
of that definition. Exports are saved on the VibeOS Desktop. The current package
limit is 24 MB; shared JSON follows the existing communication size limit.

## System memory

Settings → Memory defaults to off. Enabling it allows useful stable facts,
preferences and explicit remember/forget requests to be extracted from direct
user input in search, commands, app editing and interactions. File contents,
received app messages and generated output are not extraction sources. Most
ordinary tasks should produce no memory; fictional scenarios are not user facts.

The list supports search, manual add, edit, delete and clear. Turning memory off
retains the list, stops automatic writing, and excludes saved memory from future
model calls. Manual changes cancel/invalidate queued extraction so stale results
cannot restore deleted memories. Turning it on again uses the retained entries;
it does not scan past conversations. Memory is limited to 100 entries with a
bounded context budget. Extraction uses the existing maintenance model policy.

Relevant saved facts are supplied through the shared model entry point, with the
current request taking precedence. The extractor itself does not receive that
context a second time. Stored app data and system memory are separate: one is the
application's records or fictional world, the other is remembered user context.

## Verification

- `NODE_OPTIONS= bun test` includes lifecycle, migration, data conflicts,
  portability, memory revision guards and full read/write continuation checks.
- `NODE_OPTIONS= bun run typecheck` and `NODE_OPTIONS= bun run build`.
- Browser regression commands are in `test/regions.browser.html` and
  `test/communication.browser.html`.
