// Characters Energy Panel can typeset. Anything outside this set is rejected by the validator
// rather than silently dropped, because the artwork carries outlines, not a font.

function range(from: number, to: number): string {
  let out = '';
  for (let code = from; code <= to; code++) out += String.fromCodePoint(code);
  return out;
}

export const CHARSET: string = [
  range(0x20, 0x7e), // printable ASCII
  range(0xa0, 0xac), // Latin-1 punctuation and symbols (skips U+00AD soft hyphen)
  range(0xae, 0xff), // Latin-1 letters and symbols
  'ĀāĒēĪīŌōŪū', // macron vowels for te reo Māori
  '–—‘’“”•…−', // – — ‘ ’ “ ” • … −
].join('');
