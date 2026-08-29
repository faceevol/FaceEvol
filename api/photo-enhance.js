/*
 * FaceEvol Photo Enhance
 * Save as: /api/photo-enhance.js
 *
 * One new API route only.
 * The frontend prepares one high-quality JPEG data URI and sends it here.
 * The existing /api/prediction route is reused for Replicate polling.
 *
 * Model:
 * philz1337x/clarity-pro-upscaler
 */

const MAX_IMAGE_DATA_URI_CHARS = 3_500_000;
const ALLOWED_SCALE_FACTORS = new Set([2, 4]);

function isImageDataUri(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)
  );
}

function safeDetail(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 1200);
  }

  try {
    return JSON.stringify(value).slice(0, 1200);
  } catch {
    return String(value).slice(0, 1200);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "REPLICATE_API_TOKEN is not configured",
    });
  }

  const { image, scale_factor } = req.body || {};

  if (!isImageDataUri(image)) {
    return res.status(400).json({
      error: "A valid JPG, PNG or WebP photo is required.",
    });
  }

  if (image.length > MAX_IMAGE_DATA_URI_CHARS) {
    return res.status(413).json({
      error: "The prepared photo is too large. Please try again.",
    });
  }

  const selectedScale = Number(scale_factor);

  if (!ALLOWED_SCALE_FACTORS.has(selectedScale)) {
    return res.status(400).json({
      error: "Photo Enhance supports 2x or 4x output.",
    });
  }

  try {
    const response = await fetch(
      "https://api.replicate.com/v1/models/philz1337x/clarity-pro-upscaler/predictions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait=60",
          "Cancel-After": "4m",
        },

        body: JSON.stringify({
          input: {
            image,
            scale_factor: selectedScale,

            /*
             * Keep this conservative so faces, products and scenery stay
             * close to the source instead of being creatively re-generated.
             */
            creativity: 1,

            output_format: "png",
          },
        }),
      }
    );

    let prediction;

    try {
      prediction = await response.json();
    } catch {
      prediction = null;
    }

    if (!response.ok) {
      const details = safeDetail(
        prediction?.detail ||
          prediction?.error ||
          prediction ||
          `Replicate HTTP ${response.status}`
      );

      console.error(
        "FaceEvol Photo Enhance Replicate request failed:",
        response.status,
        details
      );

      return res.status(response.status).json({
        error: "Photo Enhance request failed.",
        details,
      });
    }

    if (!prediction || typeof prediction !== "object") {
      return res.status(502).json({
        error: "Photo Enhance returned an invalid response.",
      });
    }

    console.log(
      "FACEVOL PHOTO ENHANCE:",
      prediction.id,
      prediction.status,
      `${selectedScale}x`
    );

    return res.status(200).json({
      success: true,
      prediction,
    });
  } catch (error) {
    console.error(
      "FaceEvol Photo Enhance server error:",
      error
    );

    return res.status(500).json({
      error: "Could not start Photo Enhance.",

      details:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}
