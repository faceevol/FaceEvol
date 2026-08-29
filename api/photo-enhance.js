/*
 * FaceEvol Photo Enhance
 * Save as: /api/photo-enhance.js
 *
 * Model:
 * nightmareai/real-esrgan
 *
 * Real-ESRGAN:
 * - Upscales the complete photo
 * - GFPGAN face enhancement enabled
 * - Supports FaceEvol 2x / 4x options
 *
 * Only ONE Photo Enhance API file is required.
 * Existing /api/prediction.js is reused for polling.
 */

const MAX_IMAGE_DATA_URI_CHARS = 3_500_000;

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

function normalizeScale(value) {
  if (
    value === 4 ||
    value === "4" ||
    value === "4x" ||
    value === "4X"
  ) {
    return 4;
  }

  if (
    value === 2 ||
    value === "2" ||
    value === "2x" ||
    value === "2X"
  ) {
    return 2;
  }

  return null;
}

export default async function handler(req, res) {
  /*
   * Never cache user photo enhancement requests.
   */
  res.setHeader("Cache-Control", "no-store");

  /*
   * POST only.
   */
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  /*
   * Existing Replicate token from Vercel Environment Variables.
   */
  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "REPLICATE_API_TOKEN is not configured"
    });
  }

  const {
    image,
    scale_factor
  } = req.body || {};

  /*
   * Validate image.
   */
  if (!isImageDataUri(image)) {
    return res.status(400).json({
      error:
        "A valid JPG, PNG or WebP photo is required."
    });
  }

  /*
   * Protect the Vercel function from excessively large
   * Base64 request bodies.
   */
  if (image.length > MAX_IMAGE_DATA_URI_CHARS) {
    return res.status(413).json({
      error:
        "The prepared photo is too large. Please try another photo."
    });
  }

  /*
   * Convert FaceEvol's frontend value into
   * Real-ESRGAN's numeric scale value.
   *
   * Frontend:
   * 2 / 2x -> 2
   * 4 / 4x -> 4
   */
  const scale = normalizeScale(scale_factor);

  if (!scale) {
    return res.status(400).json({
      error:
        "Photo Enhance supports 2x or 4x enhancement."
    });
  }

  try {
    /*
     * Start Real-ESRGAN.
     *
     * Official Replicate endpoint:
     * nightmareai/real-esrgan
     */
    const response = await fetch(
      "https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",

          /*
           * Wait up to 60 seconds for a synchronous result.
           * If processing takes longer, Replicate returns the
           * prediction and FaceEvol continues polling through
           * the existing /api/prediction.js endpoint.
           */
          Prefer: "wait=60",

          /*
           * Prevent abandoned jobs from running indefinitely.
           */
          "Cancel-After": "5m"
        },

        body: JSON.stringify({
          input: {
            /*
             * High-quality JPEG data URI prepared
             * by the FaceEvol frontend.
             */
            image,

            /*
             * Actual Real-ESRGAN upscale factor.
             */
            scale,

            /*
             * IMPORTANT:
             *
             * Enable GFPGAN face restoration.
             *
             * This is the major difference from the
             * previous simple upscale tests.
             *
             * It actively reconstructs facial details
             * instead of only increasing dimensions.
             */
            face_enhance: true
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
     * Replicate returned an error.
     */
    if (!response.ok) {
      const details = safeDetail(
        prediction?.detail ||
        prediction?.error ||
        prediction ||
        `Replicate HTTP ${response.status}`
      );

      console.error(
        "FACEVOL REAL-ESRGAN ERROR:",
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
     * Make sure Replicate gave us a valid prediction.
     */
    if (
      !prediction ||
      typeof prediction !== "object"
    ) {
      return res.status(502).json({
        error:
          "Photo Enhance returned an invalid response."
      });
    }

    /*
     * Useful Vercel log information.
     */
    console.log(
      "FACEVOL REAL-ESRGAN PHOTO ENHANCE:",
      {
        id: prediction.id,
        status: prediction.status,
        scale,
        faceEnhance: true
      }
    );

    /*
     * Return the same structure already expected
     * by the FaceEvol frontend.
     *
     * If prediction.status === "succeeded",
     * prediction.output contains the enhanced image URL.
     *
     * Otherwise the existing /api/prediction.js
     * endpoint can continue polling it.
     */
    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "FACEVOL REAL-ESRGAN SERVER ERROR:",
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
