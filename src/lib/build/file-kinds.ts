const CODE_EXT = /\.(?:js|mjs|cjs|jsx|ts|tsx|css|html)$/i;
const DATA_EXT = /\.(?:json|md|txt|yml|yaml|csv)$/i;
const ASSET_EXT = /\.(?:png|jpe?g|gif|svg|webp|ico|mp3|wav|ogg|woff2?|ttf)$/i;

export const MANIFEST_PATH = ".atoms/manifest.json";

export function isCodeFile(filePath: string): boolean {
  return CODE_EXT.test(filePath);
}

export function isDataFile(filePath: string): boolean {
  return DATA_EXT.test(filePath);
}

export function isAssetFile(filePath: string): boolean {
  return ASSET_EXT.test(filePath);
}

export function isManifestPath(filePath: string): boolean {
  return filePath === MANIFEST_PATH || filePath.endsWith("/" + MANIFEST_PATH);
}

export function isContextFile(filePath: string): boolean {
  return isCodeFile(filePath) && !isManifestPath(filePath);
}