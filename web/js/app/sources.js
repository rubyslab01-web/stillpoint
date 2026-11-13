// Sleep-data sources. The native app reads Apple Health; a browser can't. This is where a
// source such as a wearable's web API would plug in later. None is built yet (Fitbit / Google
// Health integration is out of scope for now), so the list is empty and nothing is requested.
//
// A source is an object:
//   {
//     id: 'example',                     // stored in record.sleep.source
//     title: 'Example tracker',          // shown in Settings
//     isConnected(): boolean,
//     async connect(): void,             // its own consent / sign-in flow, with a plain-language explanation
//     async disconnect(): void,          // and forget any tokens
//     async sleepSummary(after: Date):   // the first main sleep after the session started
//       Promise<null | { onsetMinutes, deepMinutes, remMinutes, totalMinutes }>,
//   }
// The morning check-in calls attachSleep(); the self-experiment already compares
// record.sleep.deepMinutes and record.sleep.onsetMinutes between arms when present.

export const sleepSources = [];

export async function attachSleep(record, store) {
  for (const src of sleepSources) {
    if (!src.isConnected()) continue;
    try {
      const s = await src.sleepSummary(new Date(record.startedAt));
      if (s) {
        await store.update(record.id, (r) => { r.sleep = { source: src.id, ...s }; });
        return true;
      }
    } catch (e) { console.warn(`sleep source ${src.id}`, e); }
  }
  return false;
}
