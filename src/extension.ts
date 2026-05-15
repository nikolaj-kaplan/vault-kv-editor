import * as vscode from "vscode";
import { VaultFileSystemProvider } from "./vaultFileSystemProvider";
import { storeToken, clearToken } from "./tokenManager";
import { resolveVaultConfig, listSecrets } from "./vaultClient";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new VaultFileSystemProvider(context.secrets);

  // Register the vault:// virtual filesystem
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("vault", provider, {
      isCaseSensitive: true,
    })
  );

  // -------------------------------------------------------------------------
  // Command: Vault: Open Secret as JSON
  // -------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vaultKvEditor.openSecret",
      async () => {
        const cfg = vscode.workspace.getConfiguration("vaultKvEditor");
        const defaultMount = cfg.get<string>("defaultMount") || "secret";

        const input = await vscode.window.showInputBox({
          title: "Vault: Open Secret",
          prompt: "Paste a Vault UI URL  —or—  enter a KV mount path",
          placeHolder: "https://vault.example.com/ui/vault/secrets/my-mount/kv/my/secret/details  or  my-mount",
          value: defaultMount,
          ignoreFocusOut: true,
        });
        if (!input) {
          return;
        }

        // If the user pasted a full Vault UI URL, parse it and open directly.
        const parsed = parseVaultUiUrl(input);
        if (parsed) {
          await openVaultUri(vscode.Uri.parse(`vault://${parsed.mount}/${parsed.secretPath}`));
          return;
        }

        // Otherwise treat the input as the mount name and continue with path picker.
        const mount = input.trim();

        let config: Awaited<ReturnType<typeof resolveVaultConfig>> | undefined;
        try {
          config = await resolveVaultConfig(context.secrets);
        } catch {
          // fall through to plain input box
        }

        let secretPath: string | undefined;
        if (config?.token) {
          secretPath = await browseSecretPath(config, mount);
        } else {
          secretPath = await vscode.window.showInputBox({
            title: "Vault: Open Secret — Step 2 of 2",
            prompt: "Secret path (relative to mount)",
            placeHolder: "myapp/database",
            ignoreFocusOut: true,
          });
        }
        if (!secretPath) {
          return;
        }

        await openVaultUri(
          vscode.Uri.parse(`vault://${mount}/${secretPath}`)
        );
      }
    )
  );

  // -------------------------------------------------------------------------
  // Command: Vault: Store Token (Secure Storage)
  // -------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vaultKvEditor.storeToken",
      async () => {
        const token = await vscode.window.showInputBox({
          title: "Vault: Store Token",
          prompt:
            "Paste your Vault token. It will be stored in VS Code's encrypted secret storage, not in settings.",
          password: true,
          ignoreFocusOut: true,
        });
        if (!token) {
          return;
        }
        await storeToken(context.secrets, token);
        void vscode.window.showInformationMessage(
          "Vault token stored in secure storage."
        );
      }
    )
  );

  // -------------------------------------------------------------------------
  // Command: Vault: Clear Stored Token
  // -------------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vaultKvEditor.clearToken",
      async () => {
        await clearToken(context.secrets);
        void vscode.window.showInformationMessage(
          "Vault token cleared from secure storage."
        );
      }
    )
  );
}

export function deactivate(): void {
  // nothing to clean up
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Navigable QuickPick that lets the user browse a Vault mount's secret tree.
 * Selecting a folder (key ending with "/") drills into it; ".." goes up.
 * Falls back to a plain InputBox if listing fails or the mount is empty.
 */
async function browseSecretPath(
  config: Awaited<ReturnType<typeof resolveVaultConfig>>,
  mount: string
): Promise<string | undefined> {
  let prefix = "";

  while (true) {
    const keys = await listSecrets(config, mount, prefix);

    interface PathItem extends vscode.QuickPickItem { rawKey: string; }

    const MANUAL: PathItem = {
      label: "$(edit)  Enter path manually…",
      description: keys.length === 0 && prefix === ""
        ? "No paths returned — token may lack 'list' permission on metadata/"
        : undefined,
      rawKey: "__manual__",
    };

    const items: PathItem[] = [];
    if (prefix) {
      items.push({ label: "$(arrow-left)  ..", description: "Go up one level", rawKey: ".." });
    }
    for (const k of keys) {
      const isFolder = k.endsWith("/");
      items.push({
        label: isFolder ? `$(folder)  ${k.slice(0, -1)}/` : `$(symbol-key)  ${k}`,
        description: `vault://${mount}/${prefix}${k}`,
        rawKey: k,
      });
    }
    items.push(MANUAL);

    const picked = await vscode.window.showQuickPick(items, {
      title: `Vault: Open Secret — vault://${mount}/${prefix}`,
      placeHolder: keys.length > 0 ? "Select a secret or folder…" : "No secrets listed — select an option below",
      matchOnDescription: true,
      ignoreFocusOut: true,
    });

    if (!picked) {
      return undefined;
    }

    if (picked.rawKey === "__manual__") {
      return vscode.window.showInputBox({
        title: `Vault: Open Secret — vault://${mount}/`,
        prompt: "Secret path (relative to mount)",
        value: prefix,
        placeHolder: "myapp/database",
        ignoreFocusOut: true,
      });
    }

    if (picked.rawKey === "..") {
      const parts = prefix.slice(0, -1).split("/");
      parts.pop();
      prefix = parts.length ? parts.join("/") + "/" : "";
      continue;
    }

    const fullPath = prefix + picked.rawKey;
    if (fullPath.endsWith("/")) {
      prefix = fullPath;
      continue;
    }

    return fullPath;
  }
}

/**
 * Parses a Vault UI URL into mount + secret path.
 *
 * Handles:
 *   https://vault.example.com/ui/vault/secrets/{mount}/kv/{path}/details?version=N
 *   https://vault.example.com/ui/vault/secrets/{mount}/kv/{path}/details
 *   https://vault.example.com/ui/vault/secrets/{mount}/kv/{path}
 */
function parseVaultUiUrl(input: string): { mount: string; secretPath: string } | null {
  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    return null;
  }
  try {
    const url = new URL(input);
    // /ui/vault/secrets/{mount}/kv/{path}[/details]
    const match = url.pathname.match(/^\/ui\/vault\/secrets\/([^/]+)\/kv\/(.+?)(?:\/details)?$/);
    if (!match) {
      return null;
    }
    return { mount: match[1], secretPath: match[2] };
  } catch {
    return null;
  }
}

async function openVaultUri(uri: vscode.Uri): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    // Force JSON syntax highlighting for the virtual document
    await vscode.languages.setTextDocumentLanguage(doc, "json");
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    void vscode.window.showErrorMessage(`Vault: failed to open secret — ${err}`);
  }
}
