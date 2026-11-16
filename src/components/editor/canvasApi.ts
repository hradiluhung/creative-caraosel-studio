/**
 * Imperative view commands implemented by the mounted CanvasStage.
 * Toolbars call these instead of reaching into Konva themselves.
 */
const noop = () => {};

export const canvasApi: {
  /** Fit the whole surface (all slides of a panorama) into the viewport. */
  fit: () => void;
  /** Fit one slide into the viewport. */
  focusSlide: (index: number) => void;
  /** Multiply the zoom, anchored at the viewport center. */
  zoomBy: (factor: number) => void;
  zoomTo: (scale: number) => void;
} = { fit: noop, focusSlide: noop, zoomBy: noop, zoomTo: noop };
