/*
 * FaceEvol Video Enhance
 * Save as: /api/video-enhance.js
 *
 * Model:
 * bytedance/video-upscaler
 *
 * This route accepts only a FaceEvol private-video pathname.
 * It gives Replicate a controlled FaceEvol /api/video.mp4 proxy URL,
 * so the original Vercel Blob remains private.
 */

const ALLOWED_RESOLUTIONS =
  new Set(["1080p", "2k", "4k"]);

const ALLOWED_FPS =
  new Set([30, 60]);

const ALLOWED_SCENES =
  new Set([
    "common",
    "aigc",
    "ugc",
    "short_series",
    "old_film"
  ]);

function cleanPathname(value) {
  const pathname =
    typeof value === "string"
      ? value.trim()
      : "";

  if (
    !pathname ||
    !pathname.startsWith("faceevol-video-") ||
    !/^[a-zA-Z0-9._/-]+$/.test(pathname)
  ) {
    return null;
  }

  return pathname;
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
    pathname: rawPathname,
    target_resolution,
    target_fps,
    scene
  } = req.body || {};

  const pathname =
    cleanPathname(rawPathname);

  if (!pathname) {
    return res.status(400).json({
      error:
        "A valid FaceEvol video upload is required."
    });
  }

  const resolution =
    ALLOWED_RESOLUTIONS.has(
      target_resolution
    )
      ? target_resolution
      : "1080p";

  const fps =
    ALLOWED_FPS.has(
      Number(target_fps)
    )
      ? Number(target_fps)
      : 30;

  const selectedScene =
    ALLOWED_SCENES.has(scene)
      ? scene
      : "common";

  /*
   * Replicate cannot directly read a private Vercel Blob.
   * FaceEvol's existing /api/video.mp4 route securely streams
   * the requested private pathname for the model.
   */
  const videoUrl =
    `https://www.faceevol.com/api/video.mp4?pathname=${encodeURIComponent(pathname)}`;

  try {
    const response =
      await fetch(
        "https://api.replicate.com/v1/models/bytedance/video-upscaler/predictions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",

            /*
             * Enhancement can take several minutes,
             * especially for 2K / 4K and 60 FPS.
             */
            Prefer:
              "wait=60",

            "Cancel-After":
              "30m"
          },

          body: JSON.stringify({
            input: {
              video:
                videoUrl,

              /*
               * Standard is broadly available.
               * The Pro tier is restricted/allowlisted on Replicate,
               * so FaceEvol does not depend on it for the beta.
               */
              processing_type:
                "standard",

              scene:
                selectedScene,

              target_resolution:
                resolution,

              target_fps:
                fps
            }
          })
        }
      );

    let prediction;

    try {
      prediction =
        await response.json();
    } catch {
      prediction = null;
    }

    if (!response.ok) {
      const details =
        safeDetail(
          prediction?.detail ||
          prediction?.error ||
          prediction ||
          `Replicate HTTP ${response.status}`
        );

      console.error(
        "FaceEvol video enhancement Replicate request failed:",
        response.status,
        details
      );

      return res
        .status(response.status)
        .json({
          error:
            "Video enhancement request failed.",
          details
        });
    }

    if (
      !prediction ||
      typeof prediction !== "object"
    ) {
      return res.status(502).json({
        error:
          "Video enhancement returned an invalid response."
      });
    }

    console.log(
      "FACEVOL VIDEO ENHANCE:",
      prediction.id,
      prediction.status,
      resolution,
      `${fps}fps`,
      selectedScene
    );

    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "FaceEvol video enhancement server error:",
      error
    );

    return res.status(500).json({
      error:
        "Could not start video enhancement.",

      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
