# FaceEvol 10-tool consolidated update

This package keeps the existing Vercel Function count by adding the four new FaceEvol experiences as **modes inside existing API files**.

## Files to replace

- `index.html` -> site root `index.html`
- `api/predict.js` -> replace the current age route
- `api/photo-faceswap.js` -> replace the current photo face-swap route
- `api/faceswap.js` -> replace the current video face-swap route
- `api/prediction.js` -> replace/merge with the current prediction route (cleanup now supports both single- and multi-video source/target orientations)

No new API JavaScript file is required.

## New route modes

### `/api/predict`
- no `mode` / `mode:"age"` -> existing Age Transformation, unchanged model
- `mode:"portrait"` -> AI Portrait Creator using `qwen/qwen-image-edit-plus`
- `mode:"profile_pack"` -> AI Profile Photo Pack using `qwen/qwen-image-edit-plus`

### `/api/photo-faceswap`
- no `mode` / `mode:"single"` -> existing Photo Face Swap, unchanged model
- `mode:"multi"` -> Multiple Photo Face Swap using `ddvinh1/inswapper:25bdae46f2713138640b6e8c04dc4ca18625ce95b1863936b053eee42d9ba6db`

### `/api/faceswap`
- no `mode` / `mode:"single"` -> existing Video Face Swap, unchanged model
- `mode:"multi"` -> Multiple Video Face Swap using `skytells-research/deepface:9258be7df5239c1f38c9a667f6e0c9cb3a45e3e6520bbd7400e5c9cf4d697b24`

The earlier proposed `ddvinh1/new-faceswap-video:e0f7...` version is not used because that Replicate version is disabled.

## Credit migration

Run `faceevol-10-tool-costs.sql` in Supabase SQL Editor before deploying the new HTML/API routes.

Launch defaults:

| Tool | Credits |
|---|---:|
| Age Transformation | 1 |
| Photo Face Swap | 2 |
| Photo to Video | 5 |
| Video Face Swap | 3 |
| Photo Enhance | 2 |
| Video Enhance | 8 |
| AI Portrait Creator | 1 |
| AI Profile Photo Pack | 2 |
| Multiple Photo Face Swap | 2 |
| Multiple Video Face Swap | 4 |

Supabase remains authoritative; the values in `index.html` are display/gating values only.

## Demo media

The updated `index.html` already contains 10 demo definitions. Put prepared media under `/demos/` and fill the `FACEVOL_DEMO_MEDIA` strings. Suggested names are documented immediately above that configuration object in the HTML.

## Deployment order

1. Back up the current production files.
2. Run `faceevol-10-tool-costs.sql` in Supabase.
3. Replace `api/predict.js`, `api/photo-faceswap.js`, `api/faceswap.js`, and `api/prediction.js`.
4. Deploy those API changes first.
5. Replace and deploy `index.html`.
6. Test the existing six tools once each to confirm nothing regressed.
7. Test the four new tools while signed in.
8. Test one deliberately invalid request for each new mode and confirm credits are restored by the existing server-side refund logic.

## Important

Keep `REPLICATE_API_TOKEN`, `SUPABASE_SECRET_KEY`, Stripe secrets, and other server credentials only in Vercel environment variables. Never put them in `index.html`.
