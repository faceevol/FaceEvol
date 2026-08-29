FACEVOL LAUNCH POLISH UPDATE
===========================

Replace/add these files in your repository:

/index.html
/robots.txt
/sitemap.xml
/assets/age-presets/age-05.jpg
/assets/age-presets/age-15.jpg
/assets/age-presets/age-30.jpg
/assets/age-presets/age-50.jpg
/assets/age-presets/age-75.jpg

WHAT CHANGED
------------
- Removed public developer/implementation placeholder wording.
- Empty demo buttons now show "Example coming soon" and are disabled until
  static demo media is configured.
- Featured Result is hidden until both featured images are configured.
- Replaced the main emoji icon set with a consistent inline FaceEvol SVG icon family.
- Removed visible Beta / Live Beta badges from the creation UI.
- Legal beta disclosure remains in Terms.
- Replaced the Supabase configuration failure message with customer-safe wording.
- Signed-out header never displays a transient 0-credit balance.
- Starter pricing now says "Use across all 6 AI tools".
- Video Face Swap wording remains up to 5 seconds.
- Video Enhance now explicitly says up to 5 seconds.
- Supabase JS is pinned to 2.112.4 instead of an open @2 range.
- Five embedded age images were extracted from the HTML into cacheable files.
- Age preset images lazy-load and decode asynchronously.
- Added robots.txt and sitemap.xml.
- Stripe checkout route remains /api/prediction.
- Video Face Swap remains 3 credits in the frontend.
- No new Vercel API function was added.

DEMO MEDIA
----------
Search index.html for:
  FACEVOL_DEMO_MEDIA

When you later add static demo files, populate those paths. The View Demo buttons
automatically become available when the needed media paths are present.

FEATURED RESULT
---------------
Set:
  FACEVOL_DEMO_MEDIA.featured.before
  FACEVOL_DEMO_MEDIA.featured.after

The Featured Result block is automatically hidden until BOTH paths are set.

IMPORTANT
---------
Keep your existing a.png logo in the repository root.
This package does not replace API routes or backend model code.
