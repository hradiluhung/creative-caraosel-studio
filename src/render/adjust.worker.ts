/// <reference lib="webworker" />
/**
 * Runs the full-resolution adjustment pass off the main thread, so sliders stay responsive.
 * The pixel buffer is transferred in and back out (no copies).
 */
import type { Adjustments } from "@/document/schema";
import { applyAdjustments } from "./adjust";

export interface AdjustRequest {
  id: number;
  width: number;
  height: number;
  adjustments: Adjustments;
  buffer: ArrayBuffer;
}
export interface AdjustResponse {
  id: number;
  buffer: ArrayBuffer;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<AdjustRequest>) => {
  const { id, width, height, adjustments, buffer } = event.data;
  const data = new Uint8ClampedArray(buffer);
  applyAdjustments(data, width, height, adjustments);
  const response: AdjustResponse = { id, buffer: data.buffer as ArrayBuffer };
  scope.postMessage(response, [response.buffer]);
};
