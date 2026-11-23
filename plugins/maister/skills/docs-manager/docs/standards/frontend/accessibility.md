## Accessibility

### Native Elements Before ARIA
A control that acts is a `<button>` and one that navigates is an `<a href>`, never a `<div>` or `<span>` with a click handler. Use ARIA only for a pattern HTML has no element for (tabs, combobox, tree), and then build that pattern's keyboard handling from the WAI-ARIA Authoring Practices: a role adds no behaviour, and wrong ARIA is worse than none.

### Heading Structure
A visible page or section title is a heading element, and its level follows the page outline (`h1`, `h2`, `h3`, no level skipped), not the size it should look: set the size with CSS.

### Keyboard and Focus
Every control works from the keyboard, and no `tabindex` is above 0. Remove the focus outline only with a `:focus-visible` style of 3:1 contrast in its place. A modal takes focus when it opens, keeps Tab inside, closes on Escape and returns focus to the control that opened it; a native `<dialog>` opened with `showModal()` does most of this.

### Color Contrast
Text needs 4.5:1 against its background and large text (24px, or 18.5px bold) 3:1, placeholders included; a field's border and icons that carry meaning need 3:1. Work the ratio out from the colour values before using a light grey: Tailwind's `gray-400` on white is 2.5:1. Colour is never the only signal: an error or a state also has text or an icon.

### Accessible Names
An image's `alt` says what it conveys here, or is `alt=""` when it is decorative. A field has a visible `<label>` (a placeholder is not one), and its error text is linked with `aria-describedby`. An icon-only button gets a name that says what it does, and link text says where it goes, not "click here".

### Announce What Changes
A message that appears without a page load (a saved notice, a form error, a new result count) goes in a live region already present in the page: `role="status"`, or `role="alert"` for errors. Nothing focusable sits inside `aria-hidden="true"`.

### Layout at Every Width
A changed view works from 320 CSS px wide without page-level horizontal scrolling: no fixed pixel widths on its containers, and a wide table scrolls inside its own box. Don't reorder content with CSS `order` or grid placement so that the focus order departs from the visual order.

### Responsive Images
Use the project's image component when it has one. Otherwise each `<img>` gets `width` and `height`, so the page does not shift as it loads, `srcset` and `sizes` when the file is far wider than its slot, and `loading="lazy"` only below the first screen.

### Text That Scales
Set font sizes in `rem` or the project's type scale, so the reader's own font-size setting applies, never in viewport units alone. Don't block zoom with `maximum-scale` or `user-scalable=no` in the viewport meta tag.

### Target Size
A pointer target is at least 24x24 CSS px, or has that much clear space around it; a link inside a sentence is exempt. On touch layouts, icon buttons and primary controls get a 44x44 hit area, by padding rather than a larger icon.
