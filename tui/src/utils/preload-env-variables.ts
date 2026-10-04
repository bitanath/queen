import { dlopen } from "bun:ffi";

process.env.BEE_FORCE_FILE_STORE ??= "1"; //HACK saves bee token in a dotfile instead of in Keychain

if (process.env.QUEEN_ELTHUR_SHA == null && process.env.ELTHUR_MODEL == null) {
  const rel = "../../../models/Qwen3.5-4B-Q5_K_M.gguf";
  const modelPath = new URL(rel, import.meta.url).pathname;

  process.env.ELTHUR_MODEL = modelPath; //HACK loads model even for bun run dev so I can continuously test my changes woot!

  try {
    const lib = process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
    const symbols = dlopen(lib, {
      setenv: { args: ["cstring", "cstring", "i32"], returns: "i32" },
    }).symbols;
    (symbols.setenv as unknown as (name: string, value: string, overwrite: number) => number)(
      "ELTHUR_MODEL",
      modelPath,
      1,
    );
  } catch {
    console.error("Unable to set the damn env, will not be able to CD")
  }
}
