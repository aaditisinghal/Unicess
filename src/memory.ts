// Primitive Memories: the shared state every agent reads before acting and writes after.
import { PrimitiveApiClient, deleteMemory, getMemory, searchMemories, setMemory } from "@primitivedotdev/sdk/api";
import { env } from "./env";

let api: PrimitiveApiClient | undefined;

function client() {
  if (!env.primitiveApiKey) throw new Error("PRIMITIVE_API_KEY is not set; Memories needs it");
  api ??= new PrimitiveApiClient({ apiKey: env.primitiveApiKey });
  return api.client;
}

type Stored<T> = { value: T; version: string };

export async function readMemory<T>(key: string): Promise<Stored<T> | null> {
  const res = await getMemory({ client: client(), query: { key } });
  if (res.response?.status === 404) return null;
  if (res.error || !res.data) throw new Error(`Memories get ${key} failed: ${JSON.stringify(res.error)}`);
  const memory = res.data.data;
  if (!memory) return null;
  return { value: memory.value as T, version: memory.version };
}

// Create-only write. Returns false when the key already exists.
export async function createMemory(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
  const res = await setMemory({
    client: client(),
    body: { key, value: value as never, if_absent: true, ...(ttlSeconds ? { ttl_seconds: ttlSeconds } : {}) },
  });
  if (res.response?.status === 409) return false;
  if (res.error) throw new Error(`Memories create ${key} failed: ${JSON.stringify(res.error)}`);
  return true;
}

// Read, patch and write back with compare-and-set; on a conflict, re-read and re-apply the patch.
// Keep `patch` cheap and pure: it can run several times, so never call a model inside it.
export async function updateMemory<T>(key: string, init: () => T, patch: (current: T) => T): Promise<T> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const current = await readMemory<T>(key);
    const next = patch(current ? current.value : init());
    const res = await setMemory({
      client: client(),
      body: {
        key,
        value: next as never,
        ...(current ? { if_version: current.version as never } : { if_absent: true }),
      },
    });
    if (res.response?.status === 409) continue;
    if (res.error) throw new Error(`Memories update ${key} failed: ${JSON.stringify(res.error)}`);
    return next;
  }
  throw new Error(`Memories update ${key} kept conflicting; gave up after 6 attempts`);
}

export async function deleteMemoryKey(key: string): Promise<void> {
  const res = await deleteMemory({ client: client(), query: { key } });
  if (res.error) throw new Error(`Memories delete ${key} failed: ${JSON.stringify(res.error)}`);
}

export async function listMemoryKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await searchMemories({
      client: client(),
      query: { prefix, include_value: false, limit: 100, ...(cursor ? { cursor } : {}) } as never,
    });
    if (res.error || !res.data) throw new Error(`Memories search ${prefix} failed: ${JSON.stringify(res.error)}`);
    for (const memory of res.data.data ?? []) keys.push(memory.key);
    cursor = res.data.meta?.cursor ?? undefined;
  } while (cursor);
  return keys;
}
