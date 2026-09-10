import { subscriptionsSchema, subscriptionSchema, type AppSubscription } from "@vibeos/shared";
import { getDb } from "../database.ts";
import { enqueue } from "./writeQueue.ts";

export async function parseSubscriptions(html: string): Promise<AppSubscription[]> {
  const values: unknown[] = [];
  await new HTMLRewriter()
    .on("[data-vibeos-subscriptions]", {
      element(el) {
        const value: unknown = JSON.parse(el.getAttribute("data-vibeos-subscriptions")!);
        if (!Array.isArray(value)) throw new Error("communication.invalidSubscription");
        values.push(...value);
      },
    })
    .transform(new Response(html))
    .text();
  const subscriptions = subscriptionsSchema.parse(values);
  if (new Set(subscriptions.map((s) => s.id)).size !== subscriptions.length)
    throw new Error("communication.invalidSubscription");
  return subscriptions;
}

/** Called in AppMemoryRepo's snapshot write queue, alongside the matching HTML. */
export function storeDeclaredSubscriptions(windowId: string, subscriptions: AppSubscription[]) {
  const db = getDb();
  db.transaction(() => {
    db.query("DELETE FROM app_subscriptions WHERE window_id = ? AND origin = 'html'").run(windowId);
    for (const s of subscriptions)
      db.query("INSERT INTO app_subscriptions VALUES (?, ?, 'html', ?)").run(
        windowId,
        s.id,
        JSON.stringify(s),
      );
  })();
}
export function setSubscription(windowId: string, value: AppSubscription) {
  const subscription = subscriptionSchema.parse(value);
  return enqueue(() => {
    const db = getDb();
    if (!db.query("SELECT id FROM windows WHERE id = ? AND is_open = 1").get(windowId))
      throw new Error("communication.closed");
    const count = db
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM app_subscriptions WHERE window_id = ? AND origin = 'command'",
      )
      .get(windowId)!.n;
    if (
      count >= 16 &&
      !db
        .query(
          "SELECT id FROM app_subscriptions WHERE window_id = ? AND origin = 'command' AND id = ?",
        )
        .get(windowId, subscription.id)
    )
      throw new Error("communication.limit");
    db.query(
      "INSERT INTO app_subscriptions VALUES (?, ?, 'command', ?) ON CONFLICT(window_id, origin, id) DO UPDATE SET definition_json = excluded.definition_json",
    ).run(windowId, subscription.id, JSON.stringify(subscription));
  });
}
export function removeSubscription(windowId: string, id?: string) {
  return enqueue(() => {
    if (id)
      getDb()
        .query("DELETE FROM app_subscriptions WHERE window_id = ? AND id = ?")
        .run(windowId, id);
    else getDb().query("DELETE FROM app_subscriptions WHERE window_id = ?").run(windowId);
  });
}
export function listSubscriptions(): { windowId: string; subscription: AppSubscription }[] {
  const rows = getDb()
    .query<{ window_id: string; definition_json: string }, []>(
      "SELECT s.window_id, s.definition_json FROM app_subscriptions s JOIN windows w ON w.id = s.window_id WHERE w.is_open = 1 ORDER BY s.origin DESC",
    )
    .all();
  const entries = rows.map((s) => ({
    windowId: s.window_id,
    subscription: subscriptionSchema.parse(JSON.parse(s.definition_json)),
  }));
  // Explicit commands override an HTML declaration with the same id.
  return [...new Map(entries.map((s) => [s.windowId + ":" + s.subscription.id, s])).values()];
}
export function recoverSubscriptions() {
  return enqueue(() =>
    getDb()
      .query(
        "DELETE FROM app_subscriptions WHERE window_id NOT IN (SELECT id FROM windows WHERE is_open = 1)",
      )
      .run(),
  );
}
