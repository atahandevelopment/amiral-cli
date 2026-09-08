# Anti-patterns and presets

Reject generic AI styling: default purple/blue gradients, glassmorphism without purpose, excessive glow/shadows, oversized radii on every surface, gratuitous pills, giant empty hero areas, uniform card grids, decorative charts, emoji as interface icons, and animation on every element.

Also avoid off-scale spacing, arbitrary colors, low-contrast gray text, placeholder-only labels, icon-only actions without names, color-only status, hover-only controls, disabled buttons without explanation, unexpected scroll hijacking, hidden essential mobile content, and desktop layouts merely shrunk to 320px.

Do not claim to reproduce “Apple-like,” “Stripe-like,” or any named company's style. Derive direction from user goals, content, brand inputs, and the repository's system.

## Future presets

This release intentionally defines no preset. A future preset must:

1. Be named for a non-company product archetype (for example, `dense-operations` or `editorial-calm`), never a company, person, or trademark.
2. Live in its own file, be explicitly selected by the user, and declare spacing, type, color, density, motion, and accessibility decisions.
3. Layer over these requirements without weakening WCAG, interaction states, responsive checks, or repository conventions.
4. Be composable and removable; no preset may become an implicit default.
