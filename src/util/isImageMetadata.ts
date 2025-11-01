type AstroImageLike = {
  src: string;
  [key: string]: unknown;
};

export function isImageMetadata(value: unknown): value is AstroImageLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "src" in value &&
    typeof (value as { src?: unknown }).src === "string"
  );
}
