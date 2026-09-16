import { createHash } from "node:crypto";

export const WIDESYS_CATALOG_MANIFEST_SCHEMA = "brisa.widesys.catalogos.manifest.v1";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const object = record(value);
  if (!object) return value;
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

/** Hashes every persisted manifest field except the hash itself and its write timestamp. */
export function widesysCatalogManifestPayload(manifest: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(manifest).filter(([key]) => key !== "contentHash" && key !== "updatedAt"),
  );
}

export function widesysCatalogManifestContentHash(manifest: JsonRecord): string {
  const payload = JSON.stringify(canonicalize(widesysCatalogManifestPayload(manifest)));
  return createHash("sha256").update(payload).digest("hex");
}
