/**
 * Flattens a nested object to colon-separated key paths.
 *
 * Example:
 *   { "Database": { "Connection": { "Host": "localhost" } } }
 *   → { "Database:Connection:Host": "localhost" }
 */
export function flatten(
  obj: Record<string, unknown>,
  separator = ":",
  prefix = ""
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}${separator}${key}` : key;

    if (Array.isArray(value)) {
      // .NET indexed array convention: key:0, key:1, …
      const asObject = Object.fromEntries(value.map((item, i) => [String(i), item]));
      const nested = flatten(asObject as Record<string, unknown>, separator, fullKey);
      Object.assign(result, nested);
    } else if (value !== null && typeof value === "object") {
      const nested = flatten(
        value as Record<string, unknown>,
        separator,
        fullKey
      );
      Object.assign(result, nested);
    } else {
      result[fullKey] = value == null ? "" : String(value);
    }
  }

  return result;
}

/**
 * Unflattens colon-separated key paths back into a nested object.
 *
 * Example:
 *   { "Database:Connection:Host": "localhost" }
 *   → { "Database": { "Connection": { "Host": "localhost" } } }
 */
export function unflatten(
  obj: Record<string, string>,
  separator = ":"
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [rawKey, value] of Object.entries(obj)) {
    // Normalise __ (ASP.NET config convention) to the separator so both act
    // as nesting delimiters when reading from Vault.
    const key = rawKey.replace(/__/g, separator);
    const parts = key.split(separator);
    let current: Record<string, unknown> = result;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (
        !(part in current) ||
        current[part] === null ||
        typeof current[part] !== "object" ||
        Array.isArray(current[part])
      ) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  return numericKeysToArrays(result) as Record<string, unknown>;
}

/**
 * Recursively converts objects whose keys are sequential integers (0, 1, 2, …)
 * back into arrays, matching .NET's indexed-array convention.
 */
function numericKeysToArrays(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);

  const isIndexedArray =
    keys.length > 0 &&
    keys.every((k) => /^\d+$/.test(k)) &&
    keys
      .map(Number)
      .sort((a, b) => a - b)
      .every((v, i) => v === i);

  if (isIndexedArray) {
    return keys
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => numericKeysToArrays(obj[String(i)]));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = numericKeysToArrays(v);
  }
  return result;
}
