# AI Scenarios Platform

**How prepared are we for transformative AI?**

A data-driven platform that evaluates transformative AI scenarios, scores policy preparedness, and visualizes our collective readiness. Inspired by the [Climate Action Tracker](https://climateactiontracker.org/).

## Quick Start

```bash
npm install
npm run compile    # CSV data → site/data.json
npm run dev        # Serve locally at localhost:3000
```

## Architecture

- `data/` — CSV spreadsheets (scenarios, evaluations, policies). Edit these directly.
- `scripts/compile.js` — Compiles CSVs into `site/data.json`
- `site/` — Static site (HTML/CSS/JS + D3). Deploy to GitHub Pages.
- `CLAUDE.md` — Full project specification

## Data Model

| File | Purpose |
|------|---------|
| `scenarios.csv` | 10 transformative AI scenarios with STEEP analysis and policy challenge tags |
| `evaluations.csv` | Scored evaluations (likelihood, impact, preparedness) with rationale |
| `policies.csv` | Policy proposals with descriptions and citations |

## Contributing

Edit the CSVs in `data/`, run `npm run compile`, and submit a PR.

## License

MIT
