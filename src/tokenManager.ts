import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SECRET_STORAGE_KEY = "vault-kv-editor.token";

/**
 * Resolves the Vault token using this priority order:
 *   1. VAULT_TOKEN environment variable  (CI / terminal exports)
 *   2. VS Code SecretStorage              (stored via "Vault: Store Token" command)
 *   3. ~/.vault-token file                (written by `vault login` CLI)
 *
 * Never read from VS Code settings — tokens must not be stored in plaintext config.
 */
export async function getToken(
  secrets: vscode.SecretStorage
): Promise<string> {
  const env = process.env["VAULT_TOKEN"];
  if (env) {
    return env;
  }

  const stored = await secrets.get(SECRET_STORAGE_KEY);
  if (stored) {
    return stored;
  }

  const tokenFile = path.join(os.homedir(), ".vault-token");
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, "utf-8").trim();
  }

  return "";
}

export async function storeToken(
  secrets: vscode.SecretStorage,
  token: string
): Promise<void> {
  await secrets.store(SECRET_STORAGE_KEY, token);
}

export async function clearToken(
  secrets: vscode.SecretStorage
): Promise<void> {
  await secrets.delete(SECRET_STORAGE_KEY);
}
