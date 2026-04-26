// Supabase Storage exposes images at /storage/v1/object/public/. The /storage/v1/render/image/public/
// alias proxies them through an on-the-fly resize pipeline that accepts width and quality query params.
// Use this helper anywhere we need a thumbnail or downsized copy of a Supabase-hosted image.
//
// Returns the input unchanged if the URL is empty or not a Supabase public-storage URL. Callers should
// add an onError fallback to the original URL when the transform pipeline rate-limits or times out.

export function thumbnailUrl(url, { width = 400, quality = 80 } = {}) {
  if (!url) return '';
  if (!url.includes('supabase.co/storage/v1/object/public/')) return url;
  return url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')
    + `?width=${width}&quality=${quality}`;
}
