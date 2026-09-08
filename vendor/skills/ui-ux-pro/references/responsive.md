# Responsive behavior

Design mobile-first from content pressure, not device names. Verify at exactly `320px`, `768px`, `1024px`, and `1440px`, plus the widths immediately around each layout transition.

- Default transitions: compact `<768px`, medium `768–1023px`, wide `>=1024px`; change them when real content breaks earlier.
- Never hide essential content or actions solely to fit. Reflow columns, collapse secondary navigation, and make tables scroll or transform with labels.
- At 320px, prohibit page-level horizontal scrolling. Media is fluid (`max-width: 100%`) and controls retain 44px targets.
- Define navigation, ordering, grid column count, gutters, dialogs/drawers, table behavior, and long-string overflow at each transition.
- Preserve task and focus context across resize and orientation change. Account for virtual keyboards and safe-area insets on fixed controls.
