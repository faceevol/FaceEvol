/*
 * FaceEvol Photo Enhance
 * Save as: /api/photo-enhance.js
 *
 * Model:
 * sczhou/codeformer
 *
 * Purpose:
 * - Restore blurry / low-quality facial detail
 * - Enhance the background
 * - Upscale to 2x or 4x
 *
 * Only ONE Photo Enhance API file is needed.
 * Existing /api/prediction.js is reused for polling.
 */

const CODEFORMER_VERSION =
  "sczhou/codeformer:7de2ea26c616d5bf2245ad0d5e24f0ff9a6204578a5c876db53142edd9d2cd56";

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
    return value.slice(0, 1800);
  }

  try {
    return JSON.stringify(value).slice(0, 1800);
  } catch {
    return String(value).slice(0, 1800);
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
      error: "REPLICATE_API_TOKEN is not configured"
    });
  }

  const {
    image,
    scale_factor
  } = req.body || {};

  if (!isImageDataUri(image)) {
    return res.status(400).json({
      error:
        "A valid JPG, PNG or WebP photo is required."
    });
  }

  if (image.length > MAX_IMAGE_DATA_URI_CHARS) {
    return res.status(413).json({
      error:
        "The prepared photo is too large. Please try another photo."
    });
  }

  const scale = normalizeScale(scale_factor);

  if (!scale) {
    return res.status(400).json({
      error:
        "Photo Enhance supports 2x or 4x enhancement."
    });
  }

  try {
    const response = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait=60",
          "Cancel-After": "5m"
        },

        body: JSON.stringify({
          version: CODEFORMER_VERSION,

          input: {
            image,

            /*
             * FaceEvol output quality:
             *
             * 2x = enhanced
             * 4x = maximum resolution
             */
            upscale: scale,

            /*
             * Upscale restored facial details.
             */
            face_upsample: true,

            /*
             * Enhance the rest of the image using
             * Real-ESRGAN.
             */
            background_enhance: true,

            /*
             * IMPORTANT:
             *
             * Higher fidelity preserves the person's
             * original facial structure more strongly.
             *
             * Previous test:
             * 0.60 = sharper but slightly unnatural
             *
             * New setting:
             * 0.82 = more natural while keeping
             * visible restoration.
             */
            codeformer_fidelity: 0.82
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

    if (!response.ok) {
      const details = safeDetail(
        prediction?.detail ||
        prediction?.error ||
        prediction ||
        `Replicate HTTP ${response.status}`
      );

      console.error(
        "FACEVOL CODEFORMER REQUEST ERROR:",
        response.status,
        details
      );

      return res.status(response.status).json({
        error:
          "Photo Enhance request failed.",
        details
      });
    }

    if (
      !prediction ||
      typeof prediction !== "object"
    ) {
      return res.status(502).json({
        error:
          "Photo Enhance returned an invalid response."
      });
    }

    if (prediction.status === "failed") {
      const details = safeDetail(
        prediction.error ||
        prediction.logs ||
        "CodeFormer failed."
      );

      console.error(
        "FACEVOL CODEFORMER MODEL ERROR:",
        details
      );

      return res.status(502).json({
        error:
          "CodeFormer could not enhance this photo.",
        details
      });
    }

    if (prediction.status === "canceled") {
      return res.status(502).json({
        error:
          "Photo enhancement was canceled.",
        details:
          safeDetail(prediction.error)
      });
    }

    console.log(
      "FACEVOL CODEFORMER PHOTO ENHANCE:",
      {
        id: prediction.id,
        status: prediction.status,
        scale,
        fidelity: 0.82,
        faceUpsample: true,
        backgroundEnhance: true
      }
    );

    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "FACEVOL CODEFORMER SERVER ERROR:",
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
