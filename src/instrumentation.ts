export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runtimeManager } = await import("./lib/runtime/manager");
    const recovered = await runtimeManager.recover().catch(() => [] as string[]);
    if (recovered.length > 0) {
      console.log(`[runtime] recovered ${recovered.length} published project(s)`);
    }
  }
}
