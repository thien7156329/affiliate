export function getDisplayImageUrl(url?: string | null): string {
  if (!url) return '';
  if (url.includes('.amazonaws.com/')) {
    const parts = url.split('.amazonaws.com/');
    if (parts.length > 1) {
      return `/api/products/image-proxy?key=${encodeURIComponent(parts[1])}`;
    }
  }
  return url;
}
