// Minimal typings for the parts of opentype.js 2.x used by build-glyphs.ts (the package ships none).
declare module 'opentype.js' {
  namespace opentype {
    type PathCommand =
      | { type: 'M' | 'L'; x: number; y: number }
      | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
      | { type: 'Q'; x1: number; y1: number; x: number; y: number }
      | { type: 'Z' };

    interface Glyph {
      index: number;
      advanceWidth?: number;
      path: { commands: PathCommand[] };
    }

    type LocalisedName = Partial<Record<string, string>>;

    interface Font {
      unitsPerEm: number;
      names: {
        windows?: {
          fontFamily?: LocalisedName;
          fontSubfamily?: LocalisedName;
          version?: LocalisedName;
        };
      };
      tables: { os2: { sCapHeight: number; sxHeight: number } };
      charToGlyph(char: string): Glyph;
      getKerningValue(left: Glyph, right: Glyph): number;
    }
  }

  const opentype: { parse(buffer: ArrayBuffer): opentype.Font };
  export default opentype;
}
