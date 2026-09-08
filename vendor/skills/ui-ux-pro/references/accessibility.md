# Accessibility

Target WCAG 2.2 AA. Accessibility acceptance criteria are required, not optional polish.

- Normal text contrast is at least 4.5:1; large text and meaningful UI graphics are at least 3:1. Focus indicators have at least 3:1 contrast and are not obscured.
- Every function works by keyboard with logical order, no trap, visible focus, and skip navigation for repeated blocks. Targets are at least 24×24 CSS px under WCAG 2.2; prefer 44×44px for touch.
- Use semantic landmarks, headings, lists, buttons, links, labels, names, roles, and values. ARIA supplements native HTML; it does not replace it.
- Forms expose instructions and programmatic errors; status updates use appropriate live regions without stealing focus. Do not rely on color, shape, position, sound, or motion alone.
- Dialogs name themselves, contain focus while open, support Escape when safe, and restore focus to the trigger. New route/page titles are announced and focus is intentionally managed.
- Images have meaningful alternative text or empty alt when decorative. Captions/transcripts accompany timed media. Support zoom, reflow, reduced motion, high contrast, and screen-reader reading order.
