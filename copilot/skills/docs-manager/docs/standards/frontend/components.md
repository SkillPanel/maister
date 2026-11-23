## Components and Styling

### Derived State
A value that can be computed from props or other state is computed while rendering, not stored and kept in sync by an effect or watcher. Data from the server stays in the project's data-fetching layer (its query cache or store) when it has one, not copied into component state.

### Use the Design Tokens
Take colours, spacing, font sizes, radii, shadows and breakpoints from the project's tokens (its theme, CSS custom properties or utility scale) by name, not as literal `#hex` or one-off pixel values in a component. A value the tokens lack is added to them once; without tokens, reuse the values the code already has.

### Style the Way the Project Does
Style with the approach the surrounding code uses (utility classes, CSS modules, styled components or plain stylesheets) and the UI library's own props and theme. When a style does not take effect, fix the rule that wins instead of adding a second approach: no inline `style` for a static value, no `!important`, no deep selector into a library component's internals.
