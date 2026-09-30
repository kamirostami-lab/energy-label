import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/** Opens an exported PDF and returns what the tests inspect. */
export async function inspectPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(0);
  const stream = doc.context.lookup(page.node.get(PDFName.of('Contents')));
  if (!(stream instanceof PDFRawStream)) throw new Error('Expected one content stream');
  const content = new TextDecoder().decode(decodePDFRawStream(stream).decode());
  const raw = Buffer.from(bytes).toString('latin1');
  const xmp = /<x:xmpmeta[\s\S]*<\/x:xmpmeta>/.exec(Buffer.from(bytes).toString('utf8'))?.[0] ?? '';
  return {
    doc,
    page,
    content,
    raw,
    xmp,
    header: raw.slice(0, 8),
    mediaBox: page.getMediaBox(),
    trimBox: page.getTrimBox(),
    bleedBox: page.getBleedBox(),
  };
}

/** Numbers of every path-construction operator (m, l, c, re) in a content stream, in order. */
export function pathNumbers(content: string): string[] {
  return content
    .split('\n')
    .filter((line) => /\s(m|l|c|re)$/.test(line))
    .flatMap((line) => line.split(' ').slice(0, -1));
}
