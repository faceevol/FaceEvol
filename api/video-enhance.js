import {
  head,
  issueSignedToken,
  presignUrl
} from "@vercel/blob";

/*
 * FaceEvol Video Enhance
 * Save as: /api/video-enhance.js
 *
 * Model:
 * bytedance/video-upscaler
 *
 * This version creates a short-lived, GET-only signed URL for
 * the private Vercel Blob and gives that URL directly to Replicate.
 * That avoids routing the model's entire video download through
 * /api/video.mp4.
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

const SIGNED_URL_LIFETIME_MS =
  2 * 60 * 60 * 1000;

function cleanPathname(value) {
  const pathname =
    typeof value === "string"
      ? value.trim()
      : "";

  if (
    !pathname ||
    !pathname.startsWith("faceevol-video-") ||
    !pathname.toLowerCase().endsWith(".mp4") ||
    !/^[a-zA-Z0-9._/-]+$/.test(pathname)
  ) {
    return null;
  }

  return pathname;
}

function safeDetail(value) {
  if (!value) return "";

  if (typeof value === "string") {
    return value.slice(0, 1600);
  }

  try {
    return JSON.stringify(value).slice(0, 1600);
  } catch {
    return String(value).slice(0, 1600);
  }
}

async function createTemporaryVideoReadUrl(
  pathname
) {
  let metadata;

  try {
    metadata =
      await head(pathname);
  } catch (error) {
    throw new Error(
      `PRIVATE_VIDEO_NOT_FOUND: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  if (
    !metadata ||
    !metadata.pathname
  ) {
    throw new Error(
      "PRIVATE_VIDEO_NOT_FOUND: FaceEvol could not find the uploaded video."
    );
  }

  if (
    metadata.size !== undefined &&
    metadata.size !== null &&
    Number(metadata.size) <= 0
  ) {
    throw new Error(
      "PRIVATE_VIDEO_EMPTY: The uploaded video is empty."
    );
  }

  const validUntil =
    Date.now() +
    SIGNED_URL_LIFETIME_MS;

  const signedToken =
    await issueSignedToken({
      pathname,
      operations: ["get"],
      validUntil
    });

  const signed =
    await presignUrl(
      signedToken,
      {
        pathname,
        operation: "get",
        validUntil
      }
    );

  if (
    !signed ||
    typeof signed.presignedUrl !==
      "string" ||
    !signed.presignedUrl.startsWith(
      "https://"
    )
  ) {
    throw new Error(
      "SIGNED_VIDEO_URL_FAILED: FaceEvol could not create temporary video access."
    );
  }

  return signed.presignedUrl;
}

export default async function handler(
  req,
  res
) {
  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (
    req.method !== "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res.status(405).json({
      error:
        "Method not allowed"
    });
  }

  const replicateToken =
    process.env
      .REPLICATE_API_TOKEN;

  if (!replicateToken) {
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
  } =
    req.body || {};

  const pathname =
    cleanPathname(
      rawPathname
    );

  if (!pathname) {
    return res.status(400).json({
      error:
        "A valid FaceEvol MP4 upload is required."
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
    ALLOWED_SCENES.has(
      scene
    )
      ? scene
      : "common";

  try {
    const videoUrl =
      await createTemporaryVideoReadUrl(
        pathname
      );

    const response =
      await fetch(
        "https://api.replicate.com/v1/models/bytedance/video-upscaler/predictions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json",

            Prefer:
              "wait=60",

            "Cancel-After":
              "30m"
          },

          body:
            JSON.stringify({
              input: {
                video:
                  videoUrl,

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
          `Replicate HTTP ${
            response.status
          }`
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
      typeof prediction !==
        "object"
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

    return res
      .status(200)
      .json({
        success: true,
        prediction
      });

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "FaceEvol video enhancement server error:",
      message
    );

    if (
      message.startsWith(
        "PRIVATE_VIDEO_NOT_FOUND:"
      )
    ) {
      return res.status(404).json({
        error:
          "FaceEvol could not read the private uploaded video.",
        details:
          message
      });
    }

    if (
      message.startsWith(
        "PRIVATE_VIDEO_EMPTY:"
      )
    ) {
      return res.status(400).json({
        error:
          "The uploaded video is empty.",
        details:
          message
      });
    }

    if (
      message.startsWith(
        "SIGNED_VIDEO_URL_FAILED:"
      )
    ) {
      return res.status(500).json({
        error:
          "FaceEvol could not prepare secure AI access to the video.",
        details:
          message
      });
    }

    return res.status(500).json({
      error:
        "Could not start video enhancement.",
      details:
        message
    });
  }
}
