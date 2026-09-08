# Spacing and layout

Use repository tokens first. Otherwise use a 4px base scale: `0, 4, 8, 12, 16, 24, 32, 48, 64, 96px`. Do not invent off-scale values.

- Control internal gap before external margin. Related controls: 8px; form rows: 16px; component sections: 24px; page sections: 48px compact and 64px wide.
- Page gutters: 16px at 320–767px, 24px at 768–1023px, 32px at 1024px and above. Main readable content max-width: 1200px; prose max-width: 65ch.
- Touch controls must provide at least a 44×44px target even when the visual icon is smaller.
- Align to a deliberate grid; avoid nested containers that duplicate padding. Preserve hierarchy by using fewer, larger spacing jumps between groups.
- Specify overflow, wrapping, sticky behavior, safe-area insets, and density for data-heavy surfaces.
