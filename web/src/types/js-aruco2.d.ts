/** Minimal types for js-aruco2 (no bundled types). Only what we use. */
declare module "js-aruco2" {
  export interface ArMarker {
    id: number;
    corners: { x: number; y: number }[];
    hammingDistance: number;
  }
  export interface ArDictionaryDef {
    nBits: number;
    tau: number | null;
    codeList: Array<number | string | number[]>;
  }
  export interface ArDictionary {
    tau: number;
    nBits: number;
    markSize: number;
    find(bits: Array<string | string[]>): { id: number; distance: number } | undefined;
  }
  export interface ArDetector {
    dictionary: ArDictionary;
    detect(image: { width: number; height: number; data: Uint8ClampedArray }): ArMarker[];
    detectImage(width: number, height: number, data: Uint8ClampedArray): ArMarker[];
  }
  export const AR: {
    DICTIONARIES: Record<string, ArDictionaryDef>;
    Dictionary: new (name: string) => ArDictionary;
    Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => ArDetector;
  };
}
