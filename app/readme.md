# Extensible Content — Landing page

Static landing page for **Extensible Content**, the free, open-source (MIT) Chrome extension for workflow automation, data extraction, and content generation.

Deploy to **extensiblecontent.com** or any static host (Netlify, Vercel, GitHub Pages).

## Structure

- `index.html` — Single-page layout: hero, workflows, content generation, ShotStack & upload-post, platforms, upgrades, footer
- `styles/main.css` — Layout, typography, responsive, dark theme
- `scripts/main.js` — Lottie init, scroll-triggered animations, CTA
- `assets/icons/` — SVG icons (workflow, rows, run, output)
- `assets/lottie/` — Optional local Lottie JSON files (currently using CDN)

## Run locally

Serve the `landing` directory with any static server, e.g.:

```bash
cd landing && npx serve .
```

Or open `index.html` in a browser (relative paths work for same-origin assets).

## Links

- **Create account / backend:** [extensiblecontent.com](https://extensiblecontent.com)
- **Chrome Web Store:** Add link when the extension is published
- **GitHub:** Add repo link when public
