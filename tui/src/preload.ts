// bee-cli stores credentials in the macOS Keychain via Bun.secrets
// (bee-cli/sources/secureStore.ts). Because dist/queen is ad-hoc signed — a new
// signature on every build — macOS treats each build as an untrusted app and
// prompts for the login password on every launch (loadToken -> Bun.secrets.get).
//
// Default to bee-cli's file-based store instead: ~/.bee/token-<env> and
// ~/.bee/pairing-<env>.json, mode 0600. Set BEE_FORCE_FILE_STORE=0 to opt back
// into the Keychain. The env var is read lazily by secureStore, so importing
// this before anything that loads a token is sufficient.
process.env.BEE_FORCE_FILE_STORE ??= "1";
