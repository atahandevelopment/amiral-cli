# Motion

Motion must explain causality, state, or spatial relationship. If it does none of these, omit it.

- Micro feedback: 100–150ms; standard transitions: 150–250ms; large spatial transitions: 250–400ms. Avoid UI motion over 500ms.
- Use ease-out for entering, ease-in for leaving, and ease-in-out for movement on screen. Animate `transform` and `opacity`; avoid layout-triggering properties.
- Never delay task completion for animation. Do not autoplay decorative loops, parallax, flashing, or surprise motion.
- Honor `prefers-reduced-motion: reduce`: remove nonessential motion, replace spatial movement with instant state or a brief opacity change, and stop autoplay.
- Keep focus placement and announcements synchronized with the completed state, not an intermediate animation frame.
