# Ubyport Helper

A small web app for registering foreign guests of short-term rentals in Prague with the Czech police ([Ubyport](https://ubyport.policie.cz/)).

Passport photo from WhatsApp → Claude reads the document → you check the details → download a `.unl` file → upload it in Ubyport.

**Walkthrough video:** [docs/walkthrough.mp4](docs/walkthrough.mp4)

## Features

- Several apartments, each with its own Ubyport ID (IDUB) and colour.
- Reads passports and ID cards from photos. Photos wait in a tray first, where you can rotate or remove them. You can also paste a photo copied in WhatsApp, or drop one onto the page on a computer. Reading shows progress and can be cancelled.
- Re-checks the passport's machine-readable zone (MRZ) check digits after every edit, and fixes misread numbers and dates.
- Every guest must be confirmed with **Looks good** before export. Guests show as compact rows, with their photo beside the fields while you check them.
- Tracks what was exported and reported. If the data changes afterwards, the stay shows **Changed since export** or **Changed after reporting**.
- Reporting is confirmed in a dialog: the method, the receipt check and an optional reference.
- Shows the reporting deadline: 3 working days after arrival, skipping weekends and Czech public holidays.
- Generates the Ubyport UNL import file (Windows-1250, CRLF), one file per apartment. Characters Ubyport can't accept are flagged before downloading.
- **Preview** shows the file before downloading, either as readable cards per guest or as the raw file.
- Finished sections fold into a one-line summary (apartment and dates, guests reviewed). Tap to open them again.
- Copy buttons for each field, for typing into the Ubyport web form instead.
- Ready-made WhatsApp messages asking guests for photos and their home address, in English, Czech and Russian.
- Leaves out Czech citizens, who are not reported. Guests can also be entered by hand, with no API key.
- No server. Data stays in the browser, with backup reminders, sharing to iCloud Drive or Files, and checked restore with Undo.
- Five themes: Praha (golden hour), Prague by night, Vltava, Petřín in spring, and Classic, which follows the phone's dark mode.
- English, Czech and Russian. Russian is the default; switch with the globe button or in Settings.
- The Back button works, Undo replaces confirmation dialogs, and every theme passes an automated accessibility scan.

## Using it

Open the GitHub Pages URL on the phone and choose *Add to Home Screen*. In **Settings**:

1. Add each apartment using the details from its Ubyport registration.
2. Paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys). The key is stored only on the device. Photos go straight from the phone to the Anthropic API and are not kept by the app.

## Privacy

The page is public, but it holds no data. GitHub Pages only serves the code, and every visitor starts with an empty app.

- Guest details, apartments and the API key are stored in the browser's `localStorage` on her device and never leave it.
- Photos are resized in the browser and sent straight to the Anthropic API. They are not stored anywhere.
- A Content-Security-Policy allows the page to connect only to `https://api.anthropic.com`. The browser blocks any other destination, even if the code were changed.
- Downloaded `.unl` files and backups contain personal data. Keep them private and delete old copies.

## Development

```bash
npm ci
npm test            # unit tests: UNL format, MRZ, deadlines, workflow rules, backups
npm run build       # src/ + public/ -> dist/ (one self-contained page, icons, manifest)
npm run test:e2e    # browser tests against dist/, with the Claude API mocked
```

Each push to `main` runs both test suites in GitHub Actions, then builds and deploys `dist/` to GitHub Pages (`.github/workflows/pages.yml`).

| File | Purpose |
|---|---|
| `src/unl.js` | UNL file builder and Windows-1250 encoder |
| `src/mrz.js` | Parses TD3 (passport) and TD1 (ID card) MRZ lines and checks their check digits |
| `src/extract.js` | Claude API call with structured JSON output |
| `src/deadline.js` | Reporting deadline in Czech working days |
| `src/app.js` | User interface |
| `src/validate.js` | Completeness, review, export and report rules |
| `src/store.js` | Saving, migration, backups and restore checks |
| `src/i18n.js` | English, Czech and Russian translations |
| `src/themes.js`, `src/scenery.js` | Colour themes and the Prague skyline |
| `src/country-names.js` | Country names in three languages, plus flag codes (generated) |

The UNL layout follows [martiner/ubyport](https://github.com/martiner/ubyport), whose output Ubyport accepts. Before relying on the app, upload one real file and check that the receipt (*doručenka*) shows every record as accepted.
