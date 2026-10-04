// PDF export. Content streams are written here rather than with pdf-lib's drawing API, so the file
// carries no font resources at all and reuses the SVG's exact path numbers: one matrix maps the
// layout's millimetres (y down) to PDF points (y up). pdf-lib supplies the document structure.
import { PDFDocument, PDFHexString, PDFName, PDFString, type PDFContext } from 'pdf-lib';
import { fingerprint, utf8 } from './bytes.ts';
import { FONT, rectCommands, type PanelLayout } from './layout.ts';
import { crc32 } from './png.ts';
import type { GreyImage } from './raster.ts';
import { SPOT_COLOUR_NAME } from './svg.ts';
import { fmt, outlineCommands, type PathCommand } from './text.ts';
import type { ColourVariant } from './types.ts';

export const PT_PER_MM = 72 / 25.4;
/** 72 / 25.4 to nine decimals: under 1e-7 pt of error across a 120 mm panel. */
const MM_TO_PT = '2.834645669';
const PRODUCER = 'Energy Panel (pdf-lib 1.17.1)';

/** pdfx4: PDF 1.6 prepared to PDF/X-4 rules. pdf14: the EPS-compatible PDF 1.4. */
export type PdfFlavour = 'pdfx4' | 'pdf14';

/** The printing condition a PDF/X-4 file declares. Only with one does the file claim PDF/X-4. */
export interface OutputIntent {
  /** Registered characterisation, e.g. "FOGRA39". */
  identifier: string;
  /** Human-readable condition, e.g. "Coated FOGRA39 (ISO 12647-2:2004)". */
  info: string;
  /** Registry of the identifier, normally "http://www.color.org". */
  registry: string;
  /** The CMYK output ICC profile, embedded as DestOutputProfile. */
  iccProfile: Uint8Array;
}

export interface PdfMeta {
  title: string;
  rulesVersion: string;
  /** Issue date as YYYY-MM-DD. Every date in the file derives from it, so exports reproduce. */
  issuedOn: string;
  /** PDF/X-4 flavour only. Without it the file follows X-4 rules but does not claim conformance. */
  outputIntent?: OutputIntent;
}

/** Points to four decimals. */
export function toPt(mm: number): number {
  return Math.round(mm * PT_PER_MM * 10000) / 10000;
}

function num(value: number): string {
  const text = value.toFixed(4).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

/** PDF path operators for outline commands, in the caller's coordinate space. */
export function pdfPathOps(commands: readonly PathCommand[]): string {
  return commands
    .map((c) => {
      if (c[0] === 'Z') return 'h';
      if (c[0] === 'C')
        return `${fmt(c[1])} ${fmt(c[2])} ${fmt(c[3])} ${fmt(c[4])} ${fmt(c[5])} ${fmt(c[6])} c`;
      return `${fmt(c[1])} ${fmt(c[2])} ${c[0] === 'M' ? 'm' : 'l'}`;
    })
    .join('\n');
}

/** Fill operators for the whole panel in layout millimetres, path for path as in the SVG. */
export function panelPaths(layout: PanelLayout): string {
  const paths = [
    layout.rects.flatMap(rectCommands),
    ...layout.texts.map((t) => outlineCommands(FONT, t.text, t.sizeMm, t.x, t.baseline)),
  ];
  return paths.map((path) => `${pdfPathOps(path)}\nf`).join('\n');
}

/** Draws the page image `name` with its top-left corner at (x, y), `width` × `height` mm. */
export function imageOps(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  // The y-down page space flips the image's unit square, whose first row is at its top.
  return `q\n${fmt(width)} 0 0 ${fmt(-height)} ${fmt(x)} ${fmt(y + height)} cm\n/${name} Do\nQ`;
}

/** Sets the fill colour: CMYK black 0/0/0/100, white 0/0/0/0, or 100% of the "Panel" spot. */
export function colourOps(colour: ColourVariant): string {
  if (colour === 'spot') return `/${SPOT_COLOUR_NAME} cs 1 scn`;
  return colour === 'white' ? '0 0 0 0 k' : '0 0 0 1 k';
}

/** Separation "Panel", previewed as CMYK black through a linear tint transform. */
function spotColourSpace(context: PDFContext) {
  return context.obj([
    'Separation',
    SPOT_COLOUR_NAME,
    'DeviceCMYK',
    { FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 0, 0, 1], N: 1 },
  ]);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmpPacket(fields: {
  title: string;
  subject: string;
  isoDate: string;
  documentId: string;
  pdfx4: boolean;
}): string {
  const { title, subject, isoDate, documentId, pdfx4 } = fields;
  return [
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    ' xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"',
    ` xmlns:pdf="http://ns.adobe.com/pdf/1.3/"${pdfx4 ? '\n xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/"' : ''}>`,
    '<dc:format>application/pdf</dc:format>',
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>`,
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(subject)}</rdf:li></rdf:Alt></dc:description>`,
    '<xmp:CreatorTool>Energy Panel</xmp:CreatorTool>',
    `<xmp:CreateDate>${isoDate}</xmp:CreateDate>`,
    `<xmp:ModifyDate>${isoDate}</xmp:ModifyDate>`,
    `<xmp:MetadataDate>${isoDate}</xmp:MetadataDate>`,
    `<xmpMM:DocumentID>${documentId}</xmpMM:DocumentID>`,
    `<xmpMM:InstanceID>${documentId}</xmpMM:InstanceID>`,
    '<xmpMM:VersionID>1</xmpMM:VersionID>',
    '<xmpMM:RenditionClass>default</xmpMM:RenditionClass>',
    `<pdf:Producer>${PRODUCER}</pdf:Producer>`,
    '<pdf:Trapped>False</pdf:Trapped>',
    ...(pdfx4 ? ['<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>'] : []),
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('\n');
}

/** Validates YYYY-MM-DD and returns midnight UTC on that day. */
export function issueDate(issuedOn: string): Date {
  const date = new Date(`${issuedOn}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== issuedOn
  ) {
    throw new RangeError(`Expected an issue date as YYYY-MM-DD, got "${issuedOn}"`);
  }
  return date;
}

export interface PdfPage {
  widthMm: number;
  heightMm: number;
  /** Content operators in millimetres, y down from the top-left corner. */
  content: string;
  /** Whether the content uses the "Panel" separation. */
  spot: boolean;
  /** Greyscale images the content draws by name (imageOps): the panels of a preview proof. */
  images?: ReadonlyArray<{ name: string; image: GreyImage }>;
}

export interface PdfDocumentInfo {
  version: '1.4' | '1.6';
  title: string;
  subject: string;
  issuedOn: string;
  outputIntent?: OutputIntent | undefined;
}

/** Writes a one-page PDF. Deterministic: the same page and info give the same bytes. */
export async function writePdf(page: PdfPage, info: PdfDocumentInfo): Promise<Uint8Array> {
  const date = issueDate(info.issuedOn);
  const doc = await PDFDocument.create({ updateMetadata: false });
  const { context } = doc;

  const width = toPt(page.widthMm);
  const height = toPt(page.heightMm);
  const pdfPage = doc.addPage([width, height]);
  pdfPage.setTrimBox(0, 0, width, height);
  pdfPage.setBleedBox(0, 0, width, height);

  const content = `q\n${MM_TO_PT} 0 0 -${MM_TO_PT} 0 ${num(height)} cm\n${page.content}\nQ\n`;
  const images = page.images ?? [];
  const xObjects = Object.fromEntries(
    images.map(({ name, image }) => [
      name,
      context.register(
        context.flateStream(image.pixels, {
          Type: 'XObject',
          Subtype: 'Image',
          Width: image.width,
          Height: image.height,
          ColorSpace: 'DeviceGray',
          BitsPerComponent: 8,
        }),
      ),
    ]),
  );
  pdfPage.node.set(
    PDFName.of('Resources'),
    context.obj({
      ...(page.spot ? { ColorSpace: { [SPOT_COLOUR_NAME]: spotColourSpace(context) } } : {}),
      ...(images.length > 0 ? { XObject: xObjects } : {}),
    }),
  );
  pdfPage.node.set(PDFName.of('Contents'), context.register(context.flateStream(utf8(content))));

  const id = fingerprint(
    [
      info.version,
      info.title,
      info.subject,
      info.issuedOn,
      info.outputIntent?.identifier ?? '',
      content,
      ...images.map(
        ({ name, image }) => `${name} ${image.width}x${image.height} ${crc32(image.pixels)}`,
      ),
    ].join('\n'),
  );
  context.trailerInfo.ID = context.obj([PDFHexString.of(id), PDFHexString.of(id)]);
  context.trailerInfo.Info = context.register(
    context.obj({
      Title: PDFHexString.fromText(info.title),
      Subject: PDFHexString.fromText(info.subject),
      Creator: PDFString.of('Energy Panel'),
      Producer: PDFString.of(PRODUCER),
      CreationDate: PDFString.fromDate(date),
      ModDate: PDFString.fromDate(date),
      Trapped: 'False',
    }),
  );

  const intent = info.version === '1.6' ? info.outputIntent : undefined;
  const xmp = xmpPacket({
    title: info.title,
    subject: info.subject,
    isoDate: `${info.issuedOn}T00:00:00Z`,
    documentId: `uuid:${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    pdfx4: intent !== undefined,
  });
  doc.catalog.set(
    PDFName.of('Metadata'),
    context.register(context.stream(utf8(xmp), { Type: 'Metadata', Subtype: 'XML' })),
  );
  if (intent) {
    const profile = context.register(context.flateStream(intent.iccProfile, { N: 4 }));
    doc.catalog.set(
      PDFName.of('OutputIntents'),
      context.obj([
        context.obj({
          Type: 'OutputIntent',
          S: 'GTS_PDFX',
          OutputConditionIdentifier: PDFHexString.fromText(intent.identifier),
          RegistryName: PDFHexString.fromText(intent.registry),
          Info: PDFHexString.fromText(intent.info),
          DestOutputProfile: profile,
        }),
      ]),
    );
  }

  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false });
  return withVersion(bytes, info.version);
}

/**
 * pdf-lib always writes a "%PDF-1.7" header. The minor version is one byte at a fixed offset, so it
 * is patched in place without moving any cross-reference offset. Nothing written here needs more
 * than the declared version: classic xref table, no object streams, Flate, Separation, XMP.
 */
function withVersion(bytes: Uint8Array, version: '1.4' | '1.6'): Uint8Array {
  const expected = '%PDF-1.7';
  for (let i = 0; i < expected.length; i++) {
    if (bytes[i] !== expected.charCodeAt(i)) throw new Error('Unexpected PDF header from pdf-lib');
  }
  bytes[7] = version.charCodeAt(2);
  return bytes;
}

/** The panel as a one-page PDF, the page exactly the panel's bounds. */
export function renderPanelPdf(
  layout: PanelLayout,
  colour: ColourVariant,
  flavour: PdfFlavour,
  meta: PdfMeta,
): Promise<Uint8Array> {
  return writePdf(
    {
      widthMm: layout.width,
      heightMm: layout.height,
      content: `${colourOps(colour)}\n${panelPaths(layout)}`,
      spot: colour === 'spot',
    },
    {
      version: flavour === 'pdf14' ? '1.4' : '1.6',
      title: meta.title,
      subject: `FSANZ energy statement, rules ${meta.rulesVersion}`,
      issuedOn: meta.issuedOn,
      outputIntent: flavour === 'pdfx4' ? meta.outputIntent : undefined,
    },
  );
}
