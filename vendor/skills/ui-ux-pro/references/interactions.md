# Interactions and states

Specify default, hover, active, focus-visible, disabled, loading, success, error, empty, and read-only states where relevant.

- Use native controls and familiar behavior. Hover must never be the only path; touch and keyboard receive equivalent functionality.
- Focus-visible styling must be unmistakable and must not be removed. Keep destructive actions distinct and confirm only costly or irreversible actions.
- Disable submission only when the reason is apparent. Keep entered data after recoverable errors, place errors next to fields, summarize multiple errors, and focus the summary.
- For latency under 300ms avoid flicker; above 300ms show progress. Use skeletons for stable content layouts and determinate progress when measurable. Prevent duplicate submission.
- Empty states explain what happened and offer the next valid action. Optimistic changes must be reversible and disclose failure.
- Tooltips supplement labels, open on focus and hover, dismiss with Escape, and contain no required interactive action.
