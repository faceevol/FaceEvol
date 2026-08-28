/*
 * FaceEvol Photo Face Swap
 * Save as: /api/photo-faceswap.js
 *
 * Source face  -> swap_image
 * Target photo -> input_image
 *
 * The frontend sends compact JPEG data URIs so no additional public image
 * storage is required for this photo-to-photo beta.
 */

const MODEL_VERSION =
  "codeplugtech/face-swap:278a81e7ebb22db98bcba54de985d22cc1abeead2754eb1f2af717247be69b34";

/*
 * The frontend currently targets about 220–240 KB per JPEG before Base64.
 * Base64 expands the string, so these limits leave comfortable headroom.
 */
const MAX_IMAGE_DATA_URI_CHARS = 550_000;
const MAX_TOTAL_DATA_URI_CHARS = 1_150_000;

function isImageDataUri(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(?:jpeg|jpg|png|webp);base64,/i.test(value)
  );
}

function safeDetail(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 1000);
  }

  try {
    return JSON.stringify(value).slice(0, 1000);
  } catch {
    return String(value).slice(0, 1000);
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

  const { face, target } = req.body || {};

  if (!isImageDataUri(face)) {
    return res.status(400).json({
      error: "A valid source face image is required.",
    });
  }

  if (!isImageDataUri(target)) {
    return res.status(400).json({
      error: "A valid target image is required.",
    });
  }

  if (
    face.length > MAX_IMAGE_DATA_URI_CHARS ||
    target.length > MAX_IMAGE_DATA_URI_CHARS ||
    face.length + target.length > MAX_TOTAL_DATA_URI_CHARS
  ) {
    return res.status(413).json({
      error:
        "The prepared photos are too large for the photo face swap request. Please try again.",
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

          /*
           * Ask Replicate to wait when it can. If the model needs longer,
           * the frontend continues through the existing /api/prediction poller.
           */
          Prefer: "wait",
        },

        body: JSON.stringify({
          version: MODEL_VERSION,

          input: {
            /*
             * Verified model schema:
             * swap_image  = source face to insert
             * input_image = target photo receiving the face
             */
            swap_image: face,
            input_image: target,
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
        "FaceEvol photo face swap Replicate request failed:",
        response.status,
        details
      );

      return res.status(response.status).json({
        error: "Photo face swap request failed.",
        details,
      });
    }

    if (!prediction || typeof prediction !== "object") {
      return res.status(502).json({
        error: "Photo face swap returned an invalid response.",
      });
    }

    return res.status(200).json({
      success: true,
      prediction,
    });

  } catch (error) {
    console.error(
      "FaceEvol photo face swap server error:",
      error
    );

    return res.status(500).json({
      error: "Could not start the photo face swap.",
      details:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}
