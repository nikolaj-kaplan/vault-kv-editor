# Vault KV Editor

Edit HashiCorp Vault KV secrets as nested JSON directly in VS Code.

Vault stores secrets with flat, colon-separated keys:

```json
{
  "Database:Connection:Host": "db.example.com",
  "Database:Connection:Password": "s3cr3t",
  "FeatureFlags:NewUI": "true"
}
```

This extension lets you view and edit those secrets as a normal nested JSON document:

```json
{
  "Database": {
    "Connection": {
      "Host": "db.example.com",
      "Password": "s3cr3t"
    }
  },
  "FeatureFlags": {
    "NewUI": "true"
  }
}
```

When you press **Ctrl+S / Cmd+S**, the extension flattens the JSON back to colon-separated keys and writes it to Vault.

---

## Prerequisites

- [Vault CLI](https://developer.hashicorp.com/vault/install) installed
- Authenticated to your Vault server (see below)

---

## Authentication

The extension resolves your Vault token in this order:

| Priority | Source | How to set it |
|----------|--------|---------------|
| 1 | `VAULT_TOKEN` env var | `export VAULT_TOKEN=hvs.xxx` |
| 2 | VS Code Secure Storage | Run **Vault: Store Token (Secure Storage)** |
| 3 | `~/.vault-token` file | Run `vault login` in a terminal (recommended) |

**Recommended**: log in once with the Vault CLI — the token is written to `~/.vault-token` and the extension picks it up automatically:

```bash
export VAULT_ADDR=https://your-vault-server.example.com
vault login -method=oidc
```

---

## Usage

1. Open the Command Palette (`Cmd+Shift+P`)
2. Run **Vault: Open Secret as JSON**
3. Enter the **mount** (e.g. `secret`) and the **secret path** (e.g. `myapp/database`)
4. The secret opens as a nested JSON document with full syntax highlighting
5. Edit the values and press **Cmd+S** to save back to Vault

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `vaultKvEditor.vaultAddress` | `https://vault.example.com` | Vault server URL. Falls back to `VAULT_ADDR` env var. |
| `vaultKvEditor.kvVersion` | `2` | KV engine version (1 or 2) |
| `vaultKvEditor.defaultMount` | `secret` | Pre-filled mount name in the Open Secret prompt |
| `vaultKvEditor.namespace` | _(empty)_ | Vault namespace (Enterprise). Falls back to `VAULT_NAMESPACE`. |
| `vaultKvEditor.tlsSkipVerify` | `false` | Disable TLS verification (dev only) |

---

## Install for the team (VSIX)

**Build the `.vsix` package:**

```bash
cd vault-kv-editor
npm install
npm run package
```

This produces `vault-kv-editor-0.1.0.vsix`.

**Install in VS Code:**

```bash
code --install-extension vault-kv-editor-0.1.0.vsix
```

Or via the UI: Extensions → `···` menu → **Install from VSIX…**

**To update:** bump the `version` field in `package.json`, rebuild, and reinstall.

---

## Development

```bash
npm install
npm run watch    # compile TypeScript in watch mode
```

Press **F5** in VS Code to launch an Extension Development Host with the extension loaded.

---

## Security notes

- Vault tokens are **never** stored in VS Code `settings.json`. The "Store Token" command uses VS Code's encrypted `SecretStorage` API (backed by the OS keychain).
- The recommended flow is `vault login` via CLI — no token handling in VS Code at all.
- `tlsSkipVerify` should never be enabled in production.
