/// <reference lib="webworker" />
/**
 * Runs the full-resolution adjustment pass off the main thread, so sliders stay responsive.
 * The pixel buffer is transferred in and back out (no copies).
 */
import type { ImageLook } from "@/document/schema";
import { applyLook } from "./adjust";

export interface AdjustRequest {
  id: number;
  width: number;
  height: number;
  look: ImageLook;
  buffer: ArrayBuffer;
}
export interface AdjustResponse {
  id: number;
  buffer: ArrayBuffer;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<AdjustRequest>) => {
  const { id, width, height, look, buffer } = event.data;
  const data = new Uint8ClampedArray(buffer);
  applyLook(data, width, height, look);
  const response: AdjustResponse = { id, buffer: data.buffer as ArrayBuffer };
  scope.postMessage(response, [response.buffer]);
};
