<p align="center">
  <img src="assets/texttools.png" alt="Text Tools" width="320" style="image-rendering: pixelated;">
</p>

<p align="center">
  A lightweight, zero-dependency text manipulation utility.<br>
  Dark theme. Stackable operations. Before/after diff view.
</p>

---

## What is this?

Text Tools is a single-page web app for cleaning up and transforming text. Paste messy text on the left, click operations from the toolbar, and see clean results on the right. Operations stack — apply multiple transforms in sequence and toggle any of them on or off from the effects bar.

No backend. No build step. No dependencies. Open `index.html` in a browser and go.

## Features

**15 text operations** organized into logical groups:

| Group | Operations |
|-------|-----------|
| Whitespace | Remove extra spaces, Remove extra line breaks, Trim whitespace, Flatten to single line |
| Case | UPPERCASE, lowercase, Title Case, camelCase |
| Lines | Sort A-Z, Sort Z-A, Natural sort, Remove duplicates |
| Encode | URL encode, URL decode |
| Search | Find and replace (plain text + regex) |

**Stackable pipeline** — Click multiple operations and they chain together. The effects bar shows every applied operation as a toggleable pill. Click a pill to disable it, click the X to remove it. Case and sort operations are mutually exclusive within their group.

**Dual-pane layout** — Original on the left, Result on the right. Toggle between side-by-side and stacked layouts. Swap the result back to the original pane to chain further operations.

**Inline diff view** — Toggle diff highlighting on the result pane to see exactly what changed. Removed text shows in red with strikethrough, added text shows in green.

**Character/word/line counter** — Live stats bar updates as you type or apply operations.

**Dark theme** — GitHub-dark inspired aesthetic. Blue accent shades. Mono-color SVG icons. No emojis. No distractions.

## Screenshot

<p align="center">
  <em>Paste text, click operations, see results. Stack multiple transforms with the effects bar.</em>
</p>

## Getting Started

```
git clone https://github.com/user/text-tools.git
cd text-tools
open index.html
```

That's it. No `npm install`. No build. No server required.

## File Structure

```
text-tools/
  index.html        — Markup (toolbar, dual panes, controls)
  styles.css         — Dark theme, layouts, effects bar
  app.js             — UI orchestration, stackable pipeline, state
  operations.js      — Pure text transformation functions
  diff.js            — Word-level diff algorithm
  assets/
    texttools.png    — Logo
  README.md
  LICENSE
```

Every file stays under 500 lines. Separation of concerns is enforced — markup, styles, UI logic, and pure operations are all in separate files.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + Shift + H` | Toggle find and replace bar |
| `Escape` | Close find and replace bar |
| `Enter` (in find/replace inputs) | Apply replacement |

## Design Principles

- **Zero dependencies** — Pure HTML, CSS, and vanilla JS
- **No build step** — Works directly from the filesystem
- **Modular** — Each file has a single responsibility
- **Accessible** — Semantic HTML, ARIA labels on the toolbar, keyboard navigable
- **Fast** — No framework overhead, instant operations on any text size

## License

MIT
