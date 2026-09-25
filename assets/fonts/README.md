# Invoice fonts

Embedded in generated invoice PDFs (`src/modules/invoices/invoice.pdf.ts`) so the
invoice matches the storefront and renders the ₹ sign (the built-in PDF fonts lack it).

- **Fraunces** (Medium, Italic) — © The Fraunces Project Authors
- **Plus Jakarta Sans** (Regular, SemiBold, Bold) — © The Plus Jakarta Sans Project Authors

Both are licensed under the SIL Open Font License 1.1 (https://openfontlicense.org).
If these files are missing, invoices fall back to the built-in Helvetica/Times fonts.
