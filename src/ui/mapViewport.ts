export interface MapRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface MapViewport {
  x: number;
  y: number;
  zoom: number;
}

/** Test individual cards rather than their combined bounds: gaps between widely
 * separated nodes must not count as visible content. */
export function mapHasVisibleCard(
  cards: MapRectangle[],
  viewport: MapViewport,
  width: number,
  height: number,
) {
  if (
    ![viewport.x, viewport.y, viewport.zoom, width, height].every(Number.isFinite) ||
    viewport.zoom <= 0 ||
    width <= 0 ||
    height <= 0
  )
    return false;
  return cards.some((card) => {
    const x = card.x * viewport.zoom + viewport.x;
    const y = card.y * viewport.zoom + viewport.y;
    const w = card.width * viewport.zoom;
    const h = card.height * viewport.zoom;
    return (
      Math.min(x + w, width) - Math.max(x, 0) >= Math.min(40, w / 2) &&
      Math.min(y + h, height) - Math.max(y, 0) >= Math.min(30, h / 2)
    );
  });
}
