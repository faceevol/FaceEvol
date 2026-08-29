/*
 * FaceEvol Photo Enhance
 * Save as: /api/photo-enhance.js
 *
 * Model:
 * topazlabs/image-upscale
 *
 * Official Topaz Labs image enhancement model on Replicate.
 *
 * The frontend sends:
 * {
 *   image: "...data URI...",
 *   scale_factor: 2 or 4
 * }
 *
 * Existing /api/prediction.js is reused for polling.
 */

const MAX_IMAGE_DATA_URI_CHARS = 3_500_000;

const ALLOWED_SCALE_FACTORS = new Set([
  2,
  4,
  "2",
  "4",
  "2x",
  "4x"
]);

function isImageDataUri(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)
  );
}

function safeDetail(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 1500);
  }

  try {
    return JSON.stringify(value).slice(0, 1500);
  } catch {
    return String(value).slice(0, 1500);
  }
}

function normalizeScaleFactor(value) {
  if (
    value === 4 ||
    value === "4" ||
    value === "4x"
  ) {
    return "4x";
  }

  return "2x";
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error:
        "REPLICATE_API_TOKEN is not configured"
    });
  }

  const {
    image,
    scale_factor
  } = req.body || {};

  /*
   * Validate photo.
   */
  if (!isImageDataUri(image)) {
    return res.status(400).json({
      error:
        "A valid JPG, PNG or WebP photo is required."
    });
  }

  /*
   * Keep request safely below Vercel body-size limits.
   */
  if (image.length > MAX_IMAGE_DATA_URI_CHARS) {
    return res.status(413).json({
      error:
        "The prepared photo is too large. Please try again."
    });
  }

  /*
   * Validate scale.
   */
  if (!ALLOWED_SCALE_FACTORS.has(scale_factor)) {
    return res.status(400).json({
      error:
        "Photo Enhance supports 2x or 4x output."
    });
  }

  const upscaleFactor =
    normalizeScaleFactor(scale_factor);

  try {
    /*
     * Official Topaz Labs model.
     */
    const response = await fetch(
      "https://api.replicate.com/v1/models/topazlabs/image-upscale/predictions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",

          /*
           * Replicate can keep this request open for
           * up to 60 seconds.
           *
           * If Topaz needs longer, it returns a running
           * prediction and the existing FaceEvol
           * /api/prediction endpoint continues polling it.
           */
          Prefer: "wait=60",

          /*
           * Give Topaz enough total processing time,
           * especially for 4x enhancement.
           */
          "Cancel-After": "5m"
        },

        body: JSON.stringify({
          input: {
            image,

            /*
             * IMPORTANT:
             *
             * "Low Resolution V2" means it is designed
             * for LOW-QUALITY INPUT photos.
             *
             * It does NOT mean low-resolution output.
             */
            enhance_model:
              "Low Resolution V2",

            /*
             * FaceEvol UI:
             *
             * 2 -> 2x
             * 4 -> 4x
             */
            upscale_factor:
              upscaleFactor,

            /*
             * Use lossless PNG for the result so we
             * don't introduce additional JPEG compression.
             */
            output_format:
              "png",

            /*
             * Topaz face enhancement.
             *
             * Useful for portraits while keeping the
             * strength moderate enough to avoid making
             * people look artificial.
             */
            face_enhancement:
              true,

            /*
             * Helps Topaz identify the main subject.
             */
            subject_detection:
              "Foreground",

            /*
             * Sharpen enhanced faces.
             *
             * 0.75 gives a visible improvement without
             * pushing facial detail too aggressively.
             */
            face_enhancement_strength:
              0.75,

            /*
             * Keep creativity LOW.
             *
             * We want enhancement, not a newly invented
             * version of the person's face.
             */
            face_enhancement_creativity:
              0.15
          }
        })
      }
    );

    let prediction = null;

    try {
      prediction = await response.json();
    } catch {
      prediction = null;
    }

    /*
     * Replicate / Topaz returned an error.
     */
    if (!response.ok) {
      const details = safeDetail(
        prediction?.detail ||
        prediction?.error ||
        prediction ||
        `Replicate HTTP ${response.status}`
      );

      console.error(
        "FACEVOL TOPAZ PHOTO ENHANCE ERROR:",
        response.status,
        details
      );

      return res.status(response.status).json({
        error:
          "Photo Enhance request failed.",
        details
      });
    }

    /*
     * Make sure Replicate actually returned a prediction.
     */
    if (
      !prediction ||
      typeof prediction !== "object"
    ) {
      return res.status(502).json({
        error:
          "Topaz Photo Enhance returned an invalid response."
      });
    }

    console.log(
      "FACEVOL TOPAZ PHOTO ENHANCE:",
      {
        id: prediction.id,
        status: prediction.status,
        upscaleFactor,
        model: "Low Resolution V2"
      }
    );

    /*
     * The frontend can handle:
     *
     * 1. prediction.status === "succeeded"
     *    -> show result immediately
     *
     * 2. starting / processing
     *    -> continue through /api/prediction
     */
    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "FACEVOL TOPAZ PHOTO ENHANCE SERVER ERROR:",
      error
    );

    return res.status(500).json({
      error:
        "Could not start Photo Enhance.",

      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
