/*
 * FaceEvol Photo to Video
 * Save as: /api/photo-to-video.js
 *
 * Model:
 * kwaivgi/kling-v2.5-turbo-pro
 *
 * The frontend sends a compact image data URI plus the user's motion prompt.
 * The existing /api/prediction.js endpoint can poll the returned prediction ID.
 */

const MAX_IMAGE_DATA_URI_CHARS = 600_000;
const MAX_PROMPT_LENGTH = 1200;
const ALLOWED_DURATIONS = new Set([5, 10]);

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

/*
 * Quiet server-side prompt check.
 * The public UI stays simple. If a request is rejected, the frontend
 * displays only a short, friendly message asking for another prompt.
 */
function promptIsBlocked(prompt) {
  const text = String(prompt || "").toLowerCase();

  const blockedPatterns = [
    /\b(?:nude|naked|nudity|topless|bottomless|porn|pornographic|xxx)\b/i,
    /\b(?:undress|undressing|strip|stripping)\b/i,
    /\b(?:sex|sexual|intercourse|masturbat\w*|orgasm\w*)\b/i,
    /\b(?:genitals?|penis|vagina|vulva|nipples?|breasts?)\b/i,
    /\b(?:take|remove|pull)\s+(?:his|her|their|my|the|a|an)?\s*(?:t[\s-]?shirt|shirt|top|clothes|clothing|dress|pants|shorts|underwear|bra)\s+off\b/i,
    /\b(?:remove|take\s+off)\s+(?:all\s+)?(?:clothes|clothing|underwear)\b/i
  ];

  return blockedPatterns.some((pattern) => pattern.test(text));
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
    prompt,
    duration
  } = req.body || {};

  if (!isImageDataUri(image)) {
    return res.status(400).json({
      error: "A valid photo is required."
    });
  }

  /*
   * The frontend compresses the image before sending it.
   * Keeping the data URI compact makes the Vercel request more reliable.
   */
  if (image.length > MAX_IMAGE_DATA_URI_CHARS) {
    return res.status(413).json({
      error: "The prepared photo is too large. Please try again."
    });
  }

  const cleanPrompt =
    typeof prompt === "string"
      ? prompt.trim()
      : "";

  if (cleanPrompt.length < 3) {
    return res.status(400).json({
      error: "Please describe the motion you want."
    });
  }

  if (cleanPrompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      error: "The motion description is too long."
    });
  }

  if (promptIsBlocked(cleanPrompt)) {
    return res.status(400).json({
      error:
        "That prompt can't be processed. Try a different creative motion or style request.",
      code: "PROMPT_NOT_ALLOWED"
    });
  }

  const requestedDuration = Number(duration);

  const selectedDuration =
    ALLOWED_DURATIONS.has(requestedDuration)
      ? requestedDuration
      : 5;

  /*
   * Keep the user's prompt in control. The extra lines are only quality
   * guidance so Kling tries to preserve the source image and avoid common
   * image-to-video artifacts.
   */
  const modelPrompt = [
    cleanPrompt,
    "",
    "Keep the motion coherent, natural and visually smooth.",
    "Preserve the main subject's recognizable appearance, facial identity, clothing, lighting and scene unless the prompt clearly asks for a creative change.",
    "Use believable physical motion and stable temporal consistency."
  ].join("\n");

  const negativePrompt = [
    "flicker",
    "jitter",
    "warped anatomy",
    "deformed face",
    "duplicated features",
    "extra limbs",
    "sudden identity change",
    "unwanted scene cuts",
    "low quality"
  ].join(", ");

  try {
    const response = await fetch(
      "https://api.replicate.com/v1/models/kwaivgi/kling-v2.5-turbo-pro/predictions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",

          /*
           * Replicate may return the completed prediction during this wait.
           * If it takes longer, the frontend continues with /api/prediction.
           */
          Prefer: "wait=60",
          "Cancel-After": "10m"
        },

        body: JSON.stringify({
          input: {
            prompt: modelPrompt,

            /*
             * Current Kling 2.5 Turbo Pro schema uses start_image
             * for image-to-video. "image" is deprecated.
             */
            start_image: image,

            duration: selectedDuration,

            negative_prompt: negativePrompt
          }
        })
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
        "FaceEvol Kling Photo to Video request failed:",
        response.status,
        details
      );

      return res.status(response.status).json({
        error: "Photo to Video request failed.",
        details
      });
    }

    if (!prediction || typeof prediction !== "object") {
      return res.status(502).json({
        error: "Photo to Video returned an invalid response."
      });
    }

    console.log(
      "FACEVOL PHOTO-TO-VIDEO MODEL:",
      "kwaivgi/kling-v2.5-turbo-pro"
    );

    console.log(
      "FACEVOL PHOTO-TO-VIDEO:",
      prediction.id,
      prediction.status,
      `${selectedDuration}s`
    );

    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "FaceEvol Kling Photo to Video server error:",
      error
    );

    return res.status(500).json({
      error: "Could not start Photo to Video.",
      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
