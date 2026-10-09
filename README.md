# Hanjang Capture (한장캡처)

A Chrome extension that scrolls a web page from top to bottom and captures it as **one image**. You can then annotate, blur or crop the image and save it as PNG, JPG or PDF.

No account, no tracking, no network requests. Screenshots are stored **only on your computer**. The interface is in Korean.

## Features

- **Full-page capture**: auto-scrolls and stitches the whole page, including pages with sticky headers, inner scroll areas, same-site iframes and dark backgrounds. You can pause and resume.
- **Area capture**: drag to select part of a page. The page auto-scrolls when you drag to the top or bottom edge.
- **Batch capture**: paste a list of URLs (up to 200) and capture each page automatically.
- **Editor**:
  - Tools: rectangle, ellipse, arrow, line, text, highlighter, pen, blur, numbered badges and crop.
  - Undo/redo, multi-select, "reset all" and zoom (Cmd/Ctrl + mouse wheel).
  - Pen and highlighter strokes are smoothed, but intentional sharp corners are kept.
- **Export**: PNG, JPG and PDF (A4, US Letter, US Legal or the full image as one page; portrait or landscape).
  - Before saving a PDF, a preview shows where pages break. You can drag the breaks to adjust them.
  - Empty space at the bottom of a page is filled with the image's background color.
  - You can also copy to the clipboard or print.
- **My Screenshots**: a gallery of saved captures with search, multi-select, bulk save and delete.

## Install

The extension is not on the Chrome Web Store, so you install it manually:

1. Download [`release/hanjang-capture-v1.4.3.zip`](release/hanjang-capture-v1.4.3.zip) and unzip it.
2. Move the unzipped folder somewhere permanent, such as your Documents folder. Chrome loads the extension from this folder, so don't delete it.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode** (top right).
5. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
6. Optional: pin the extension using the puzzle-piece icon in the toolbar.

Chrome may show a "Disable developer mode extensions" notice at startup. You can close it.

## Usage

- Click the toolbar icon, then choose **페이지 전체** (full page) or **페이지 일부** (part of the page).
- Default shortcuts: full page `Ctrl+Shift+K` (Mac `⇧⌘K`), area `Ctrl+Shift+E` (Mac `⇧⌘E`). You can change them at `chrome://extensions/shortcuts`.

## Update

1. Download and unzip the new release zip.
2. Replace the files **inside the folder you originally loaded** with the new files. Keep the folder's name and location.
3. On `chrome://extensions`, click the reload (↻) button on the extension's card.

Your saved screenshots and settings are kept. Don't click **Remove** on the extension: that deletes all stored screenshots.

## Development

```bash
npm ci
npm run build     # type-check + build into dist/
npm test          # unit tests
npm run e2e       # browser tests (headless Chromium)
npm run package   # create the install zip in release/
```
