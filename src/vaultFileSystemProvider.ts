import * as vscode from "vscode";
import { resolveVaultConfig, readSecret, writeSecret } from "./vaultClient";
import { flatten, unflatten } from "./jsonTransformer";

/**
 * Virtual filesystem provider for the `vault://` URI scheme.
 *
 * URI format:  vault://{mount}/{secret/path}
 * Example:     vault://secret/myapp/database
 *
 * readFile  → fetches flat KV pairs from Vault → unflatten → pretty JSON
 * writeFile ← user saves the nested JSON → flatten → write flat pairs to Vault
 */
export class VaultFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> =
    this._onDidChangeFile.event;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  // VS Code calls this to check if the file "exists". We always return a
  // valid stat so that VS Code lets us open any vault:// URI (including paths
  // for secrets that don't exist yet — those start as an empty {} document).
  stat(_uri: vscode.Uri): vscode.FileStat {
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };
  }

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    // not needed
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { mount, secretPath } = parseMountAndPath(uri);

    let config;
    try {
      config = await resolveVaultConfig(this.secrets);
    } catch (err) {
      throw vscode.FileSystemError.Unavailable(String(err));
    }

    if (!config.token) {
      throw vscode.FileSystemError.Unavailable(
        "No Vault token found. Run `vault login -address=<your-vault-address>` in a terminal, " +
          "or use the command \"Vault: Store Token (Secure Storage)\"."
      );
    }

    let flatData: Record<string, string>;
    try {
      flatData = await readSecret(config, mount, secretPath);
    } catch (err) {
      throw vscode.FileSystemError.Unavailable(String(err));
    }

    const isNew = Object.keys(flatData).length === 0;
    const nested = isNew ? {} : unflatten(flatData);
    const json = JSON.stringify(nested, null, 2);

    if (isNew) {
      // Non-blocking notification — don't block the file open
      void vscode.window.showInformationMessage(
        `vault://${mount}/${secretPath} does not exist yet. Save to create it.`
      );
    }

    return Buffer.from(json, "utf-8");
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const { mount, secretPath } = parseMountAndPath(uri);

    let nested: Record<string, unknown>;
    try {
      nested = JSON.parse(Buffer.from(content).toString("utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      throw vscode.FileSystemError.Unavailable(
        "Cannot save: the document contains invalid JSON."
      );
    }

    const flatData = flatten(nested);

    let config;
    try {
      config = await resolveVaultConfig(this.secrets);
    } catch (err) {
      throw vscode.FileSystemError.Unavailable(String(err));
    }

    if (!config.token) {
      throw vscode.FileSystemError.Unavailable(
        "No Vault token found. Run `vault login -address=<your-vault-address>` in a terminal."
      );
    }

    try {
      await writeSecret(config, mount, secretPath, flatData);
    } catch (err) {
      throw vscode.FileSystemError.Unavailable(String(err));
    }

    void vscode.window.showInformationMessage(
      `Saved ${Object.keys(flatData).length} key(s) to vault://${mount}/${secretPath}`
    );
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions(
      "Delete is not supported. Use the Vault CLI: vault kv delete"
    );
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(
      "Rename is not supported via this editor."
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMountAndPath(uri: vscode.Uri): {
  mount: string;
  secretPath: string;
} {
  // vault://secret/myapp/database
  //   authority = "secret"
  //   path      = "/myapp/database"
  const mount = uri.authority;
  const secretPath = uri.path.replace(/^\//, "");
  return { mount, secretPath };
}
