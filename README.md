# Energy Panel

Generates the FSANZ `ENERGY INFORMATION` statement for packaged alcoholic beverages as outlined,
press-ready artwork. Built by Komms-Haus from Build Brief 01. The tool formats the statement; the
producer remains responsible for compliance.

Sessions 1 and 2 deliver the rules file, the panel renderer, the SVG and PDF exports and the A4
proof sheet. See [CLAUDE.md](CLAUDE.md) for the build order, architecture, conventions and open
decisions.

```
pnpm install
pnpm check
```

`pnpm check` includes a Poppler preflight of the PDFs; install `poppler-utils` to run it locally.

IBM Plex Sans is © 2017 IBM Corp. with Reserved Font Name "Plex", used under the SIL Open Font
License 1.1 ([packages/panel/fonts/OFL.txt](packages/panel/fonts/OFL.txt)).
