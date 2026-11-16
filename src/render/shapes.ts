/** Pure point generators for shapes drawn inside a width x height box. */

/** Regular polygon inscribed in the box ellipse, first vertex at the top. */
export function polygonPoints(sides: number, width: number, height: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push(width / 2 + (Math.cos(a) * width) / 2, height / 2 + (Math.sin(a) * height) / 2);
  }
  return pts;
}

export function starPoints(points: number, width: number, height: number, innerRatio = 0.45): number[] {
  const pts: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 1 : innerRatio;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push(width / 2 + (Math.cos(a) * width * r) / 2, height / 2 + (Math.sin(a) * height * r) / 2);
  }
  return pts;
}
