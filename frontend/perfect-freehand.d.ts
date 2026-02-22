declare module 'perfect-freehand' {
  export interface PerfectFreehandOptions {
    size?: number;
    thinning?: number;
    smoothing?: number;
    streamline?: number;
    easing?: (t: number) => number;
    start?: Record<string, unknown>;
    end?: Record<string, unknown>;
    simulatePressure?: boolean;
    last?: boolean;
  }

  export default function getStroke(
    points: Array<[number, number] | [number, number, number]>,
    options?: PerfectFreehandOptions,
  ): number[][];
}
