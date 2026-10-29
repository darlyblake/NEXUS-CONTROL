declare module "*.mjs?url" {
  const assetUrl: string;
  export default assetUrl;
}

declare module "mammoth/mammoth.browser" {
  export function extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>;
}
