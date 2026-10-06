# Reports admin

This is an Operate surface for club administrators entering shift finances,
reviewing reports, and recording expenses. Keep Russian interface text and
Django's existing navigation, permissions, actions, and form submission.

Use a quiet ledger layout: off-white workspace, white working surfaces,
forest-green actions, muted green-gray secondary text, and tabular money values.
Dark mode uses the same hierarchy with dark green surfaces and a lighter accent.
Typography follows the admin's system font. No decorative animation or external
fonts are needed.

Lists show date, administrator, financial values, and photo counts. Totals describe
the complete filtered result set, including pages beyond the visible page. Report
receipts mean cards + SBP + cash; remaining cash and encashment are separate.

Forms group shift details, receipts, cash handling, and comments, with an adjacent
live financial summary. Photos use image previews and Django inline forms.
Reports require at least one photo; expenses allow zero. At narrow widths, fields
and photos stack, and only the results table scrolls horizontally.

All templates and styling belong to the reports app; other admin apps keep their
existing interface.
