# Energy Panel

Generates the FSANZ `ENERGY INFORMATION` statement for packaged alcoholic beverages as outlined,
press-ready artwork. Built by Komms-Haus from Build Brief 01. The tool formats the statement; the
producer remains responsible for compliance.

Sessions 1 to 5 deliver the rules file, the panel renderer, the SVG and PDF exports, the A4 proof
sheet, the generator screen with its API, accounts with magic-link sign-in, SKU records and
stored exports (D1 and R2), and payments through Stripe, deployed as one Cloudflare Worker. See [CLAUDE.md](CLAUDE.md) for the
build order, architecture, conventions and open decisions.

```
pnpm install
pnpm db:migrate:local   # the local D1 database for dev, preview and e2e
pnpm dev                # the generator at http://localhost:5173
pnpm check
pnpm build && pnpm e2e
```

To sign in and pay locally, put `MAIL_TRANSPORT=outbox` and `STRIPE_TRANSPORT=fake` in
`apps/web/.dev.vars` (git-ignored). The sign-in link is at `/api/dev/outbox?to=<your email>`, and
checkout and the billing portal open local test pages instead of Stripe.

`pnpm check` includes a Poppler preflight of the PDFs; install `poppler-utils` to run it locally.

IBM Plex Sans is © 2017 IBM Corp. with Reserved Font Name "Plex", used under the SIL Open Font
License 1.1 ([packages/panel/fonts/OFL.txt](packages/panel/fonts/OFL.txt)).
