---
name: ui-ux-pro
description: Produces implementation-ready UI/UX direction for spacing, typography, responsive layouts, interaction states, motion, and accessibility. Use selectively for new or materially changed user-facing experiences; do not use for backend work, copy-only edits, or to replace an existing approved design system/specification.
---

# UI/UX Pro

Inspect the product and its existing design language first. Prefer existing tokens and components. If none exist, use the neutral defaults in these references and record the choice in the design rationale.

## Workflow

1. Establish user goal, content priority, platform, routes, and all UI states.
2. Read only the references needed for the decision:
   - [Spacing and layout](references/spacing.md)
   - [Typography](references/typography.md)
   - [Responsive behavior](references/responsive.md)
   - [Motion](references/motion.md)
   - [Interactions and states](references/interactions.md)
   - [Accessibility](references/accessibility.md)
   - [Anti-patterns and presets](references/anti-patterns.md)
3. Define observable behavior rather than implementation code.
4. Check every route at compact, intermediate, and wide widths, with keyboard and reduced motion.

## Priority

Repository design system and explicit user requirements override these defaults. Accessibility requirements never become optional. Explain any conflict or assumption rather than quietly inventing a rule.

## Output

When invoked by `uiux-designer`, emit only the canonical `design-spec.schema.json` object. Put system rationale in `summary`; put route-level layout and behavior in `description`; put measurable details in `acceptance_criteria`.

This skill contains no company-style presets. Future presets must be product-archetype based, live in separate reference files, remain opt-in, and never imitate or name a company.
