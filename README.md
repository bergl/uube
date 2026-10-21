# Ubyport Helper

A small web app for registering foreign guests of short-term rentals in Prague with the Czech police ([Ubyport](https://ubyport.policie.cz/)).

Passport photo from WhatsApp → Claude reads the document → you check the details → download a `.unl` file → upload it in Ubyport.

**Walkthrough video:** [docs/walkthrough.mp4](docs/walkthrough.mp4)

## Features

- Several apartments, each with its own Ubyport ID (IDUB).
- Reads passports and ID cards from photos (several at once; ID front and back are merged).
- Checks the passport's machine-readable zone (MRZ) check digits and fixes misread numbers and dates.
- Shows the reporting deadline: 3 working days after arrival, skipping weekends and Czech public holidays.
- Generates the Ubyport UNL import file (Windows-1250, CRLF), one file per apartment.
- Copy buttons for each field, for typing into the Ubyport web form instead.
- A ready-made WhatsApp message asking guests for photos and their home address.
- Leaves out Czech citizens, who are not reported.
- No server. All data stays in the browser's local storage. Use JSON backup and restore when changing phones.
- Five themes: Praha (golden hour), Prague by night, Vltava, Petřín in spring, and Classic, which follows the phone's dark mode.
- English, Czech and Russian. Russian is the default; switch with the globe button or in Settings.

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
npm test        # UNL format, MRZ check digits, deadline calculation
npm run build   # src/ → index.html (single self-contained file, served by GitHub Pages)
```

| File | Purpose |
|---|---|
| `src/unl.js` | UNL file builder and Windows-1250 encoder |
| `src/mrz.js` | Parses TD3 (passport) and TD1 (ID card) MRZ lines and checks their check digits |
| `src/extract.js` | Claude API call with structured JSON output |
| `src/deadline.js` | Reporting deadline in Czech working days |
| `src/app.js` | User interface |
| `src/i18n.js` | English, Czech and Russian translations |
| `src/themes.js`, `src/scenery.js` | Colour themes and the Prague skyline |
| `src/country-names.js` | Country names in three languages, plus flag codes (generated) |

The UNL layout follows [martiner/ubyport](https://github.com/martiner/ubyport), whose output Ubyport accepts. Before relying on the app, upload one real file and check that the receipt (*doručenka*) shows every record as accepted.
