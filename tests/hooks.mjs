// Redirects "@forge/api" imports to the mock above (offline test only).
const mockUrl = new URL("./mock-forge-api.mjs", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@forge/api") {
    return { url: mockUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
