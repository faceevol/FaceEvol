/*
 * FaceEvol Photo Face Swap
 * Save as: /api/photo-faceswap.js
 *
 * Uses small optimized data-URI images from the browser, so the photo-to-photo
 * beta does not need a second Vercel Blob upload path.
 */

const MODEL_VERSION =
  "naimish-gami/face-swapper:8b13ba2a79d97de3f36b5e79fa71347716102e5c3412e35b8830689dd68fe1b1";

const MAX_IMAGE_DATA_URI_CHARS = 1_500_000;
const MAX_TOTAL_DATA_URI_CHARS = 3_200_000;

function isImageDataUri(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)
  );
}

function safeDetail(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 700);
  }

  try {
    return JSON.stringify(value).slice(0, 700);
  } catch {
    return String(value).slice(0, 700);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const token =
    process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error:
        "REPLICATE_API_TOKEN is not configured"
    });
  }

  const {
    face,
    target
  } = req.body || {};

  /*
   * Validate source face photo
   */
  if (!isImageDataUri(face)) {
    return res.status(400).json({
      error:
        "A valid source face image is required."
    });
  }

  /*
   * Validate target photo
   */
  if (!isImageDataUri(target)) {
    return res.status(400).json({
      error:
        "A valid target image is required."
    });
  }

  /*
   * Keep request size comfortably below
   * Vercel's serverless body limit.
   */
  if (
    face.length >
      MAX_IMAGE_DATA_URI_CHARS ||
    target.length >
      MAX_IMAGE_DATA_URI_CHARS ||
    face.length +
      target.length >
      MAX_TOTAL_DATA_URI_CHARS
  ) {
    return res.status(413).json({
      error:
        "The prepared photos are too large. Please try smaller images."
    });
  }

  try {
    /*
     * Start Replicate photo face swap
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/predictions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",

            Prefer: "wait=10"
          },

          body: JSON.stringify({
            version:
              MODEL_VERSION,

            input: {
              /*
               * Face to insert
               */
              swap_image:
                face,

              /*
               * Photo receiving the face
               */
              input_image:
                target,

              /*
               * Improve final facial quality
               */
              enhance:
                true
            }
          })
        }
      );

    const prediction =
      await response.json();

    /*
     * Replicate returned an error
     */
    if (!response.ok) {
      return res
        .status(response.status)
        .json({
          error:
            "Photo face swap request failed.",

          details:
            safeDetail(
              prediction?.detail ||
              prediction?.error ||
              prediction
            )
        });
    }

    /*
     * Return prediction to browser.
     *
     * If Replicate finishes immediately,
     * prediction.status may already be
     * "succeeded".
     *
     * Otherwise the frontend continues
     * polling /api/prediction.
     */
    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "FaceEvol photo face swap error:",
      error
    );

    return res.status(500).json({
      error:
        "Could not start the photo face swap.",

      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
