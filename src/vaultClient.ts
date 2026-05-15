import * as https from "https";
import * as http from "http";
import * as vscode from "vscode";
import { getToken } from "./tokenManager";

export interface VaultConfig {
  address: string;
  token: string;
  kvVersion: 1 | 2;
  namespace: string | undefined;
  tlsSkipVerify: boolean;
}

export async function resolveVaultConfig(
  secrets: vscode.SecretStorage
): Promise<VaultConfig> {
  const cfg = vscode.workspace.getConfiguration("vaultKvEditor");

  const address =
    cfg.get<string>("vaultAddress") ||
    process.env["VAULT_ADDR"] ||
    "https://vault.example.com";

  const kvVersion = (cfg.get<number>("kvVersion") ?? 2) as 1 | 2;

  const namespace =
    cfg.get<string>("namespace") ||
    process.env["VAULT_NAMESPACE"] ||
    undefined;

  const tlsSkipVerify = cfg.get<boolean>("tlsSkipVerify") ?? false;

  const token = await getToken(secrets);

  return { address: address.replace(/\/$/, ""), token, kvVersion, namespace, tlsSkipVerify };
}

// ---------------------------------------------------------------------------
// Low-level HTTP
// ---------------------------------------------------------------------------

interface RequestOptions {
  method: string;
  url: string;
  token: string;
  namespace?: string;
  tlsSkipVerify: boolean;
  body?: unknown;
}

async function vaultRequest(opts: RequestOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(opts.url);
    const isHttps = parsed.protocol === "https:";

    const headers: Record<string, string> = {
      "X-Vault-Token": opts.token,
      "Content-Type": "application/json",
    };
    if (opts.namespace) {
      headers["X-Vault-Namespace"] = opts.namespace;
    }

    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
    if (bodyStr) {
      headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    }

    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? "443" : "80"),
      path: parsed.pathname + parsed.search,
      method: opts.method,
      headers,
      ...(isHttps
        ? {
            agent: new https.Agent({
              rejectUnauthorized: !opts.tlsSkipVerify,
            }),
          }
        : {}),
    };

    const lib: typeof https = isHttps ? https : (http as unknown as typeof https);
    const req = lib.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        const status = res.statusCode ?? 0;

        if (status === 404) {
          resolve(null); // secret not found — caller handles this
          return;
        }

        if (status === 403) {
          reject(
            new Error(
              "Vault: permission denied (403). Run `vault login -address=<your-vault-address>` to authenticate."
            )
          );
          return;
        }

        if (status >= 400) {
          let detail = body;
          try {
            const parsed = JSON.parse(body) as { errors?: string[] };
            if (parsed.errors?.length) {
              detail = parsed.errors.join("; ");
            }
          } catch {
            // use raw body
          }
          reject(new Error(`Vault: HTTP ${status} — ${detail}`));
          return;
        }

        try {
          resolve(body ? JSON.parse(body) : null);
        } catch {
          resolve(body);
        }
      });
    });

    req.on("error", reject);

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// KV operations
// ---------------------------------------------------------------------------

/**
 * Reads a KV secret and returns its flat key→value map.
 * Returns an empty object if the secret does not exist yet.
 */
export async function readSecret(
  config: VaultConfig,
  mount: string,
  secretPath: string
): Promise<Record<string, string>> {
  const apiPath =
    config.kvVersion === 2
      ? `${mount}/data/${secretPath}`
      : `${mount}/${secretPath}`;

  const url = `${config.address}/v1/${apiPath}`;
  const response = await vaultRequest({
    method: "GET",
    url,
    token: config.token,
    namespace: config.namespace,
    tlsSkipVerify: config.tlsSkipVerify,
  });

  if (response === null) {
    return {}; // secret does not exist yet → start with empty object
  }

  const r = response as Record<string, unknown>;
  if (config.kvVersion === 2) {
    return ((r["data"] as Record<string, unknown>)?.["data"] as Record<string, string>) ?? {};
  }
  return (r["data"] as Record<string, string>) ?? {};
}

/**
 * Lists secret keys (and sub-paths) under a given prefix within a mount.
 * Returns an array of strings; entries ending with "/" are sub-folders.
 * Returns an empty array if the path does not exist or listing is not permitted.
 */
export async function listSecrets(
  config: VaultConfig,
  mount: string,
  prefix: string
): Promise<string[]> {
  const subPath = prefix ? prefix : "";
  const apiPath =
    config.kvVersion === 2
      ? `${mount}/metadata/${subPath}`
      : `${mount}/${subPath}`;

  const url = `${config.address}/v1/${apiPath}`;
  let response: unknown;
  try {
    response = await vaultRequest({
      method: "LIST",
      url,
      token: config.token,
      namespace: config.namespace,
      tlsSkipVerify: config.tlsSkipVerify,
    });
  } catch {
    return [];
  }

  if (response === null) {
    return [];
  }

  const r = response as Record<string, unknown>;
  return ((r["data"] as Record<string, unknown>)?.["keys"] as string[]) ?? [];
}

/**
 * Writes a flat key→value map to a KV secret (creates or updates).
 */
export async function writeSecret(
  config: VaultConfig,
  mount: string,
  secretPath: string,
  data: Record<string, string>
): Promise<void> {
  const apiPath =
    config.kvVersion === 2
      ? `${mount}/data/${secretPath}`
      : `${mount}/${secretPath}`;

  const url = `${config.address}/v1/${apiPath}`;
  const body = config.kvVersion === 2 ? { data } : data;

  await vaultRequest({
    method: "POST",
    url,
    token: config.token,
    namespace: config.namespace,
    tlsSkipVerify: config.tlsSkipVerify,
    body,
  });
}
