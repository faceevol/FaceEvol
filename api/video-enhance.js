/*
 * FaceEvol Video Enhance
 * Save as: /api/video-enhance.js
 *
 * Model:
 * bytedance/video-upscaler
 *
 * Reliability version:
 * - No static @vercel/blob imports at module startup.
 * - The Blob SDK is loaded inside the request handler so an SDK/export
 *   mismatch returns JSON instead of crashing the Vercel Function.
 * - Replicate receives a short-lived GET-only signed URL for the private MP4.
 * - Replicate prediction starts asynchronously and the frontend polls
 *   /api/prediction.js.
 */

const ALLOWED_RESOLUTIONS =
  new Set([
    "1080p",
    "2k",
    "4k"
  ]);

const ALLOWED_FPS =
  new Set([
    30,
    60
  ]);

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
    !pathname.startsWith(
      "faceevol-video-"
    ) ||
    !pathname
      .toLowerCase()
      .endsWith(".mp4") ||
    !/^[a-zA-Z0-9._/-]+$/.test(
      pathname
    )
  ) {
    return null;
  }

  return pathname;
}


function safeDetail(value) {
  if (!value) {
    return "";
  }

  if (
    typeof value === "string"
  ) {
    return value.slice(
      0,
      2000
    );
  }

  try {
    return JSON.stringify(
      value
    ).slice(
      0,
      2000
    );
  } catch {
    return String(
      value
    ).slice(
      0,
      2000
    );
  }
}


function sendError(
  res,
  status,
  error,
  details
) {
  return res
    .status(status)
    .json({
      error,
      details:
        safeDetail(details)
    });
}


async function loadBlobSignedUrlFunctions() {
  let blobSdk;

  try {
    blobSdk =
      await import(
        "@vercel/blob"
      );
  } catch (error) {
    throw new Error(
      `BLOB_SDK_LOAD_FAILED: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  const issueSignedToken =
    blobSdk?.issueSignedToken;

  const presignUrl =
    blobSdk?.presignUrl;

  if (
    typeof issueSignedToken !==
      "function" ||
    typeof presignUrl !==
      "function"
  ) {
    const exportsFound =
      blobSdk
        ? Object.keys(blobSdk)
            .sort()
            .join(", ")
            .slice(0, 1200)
        : "none";

    throw new Error(
      `BLOB_SDK_EXPORTS_MISSING: issueSignedToken/presignUrl are unavailable. Exports found: ${exportsFound}`
    );
  }

  return {
    issueSignedToken,
    presignUrl
  };
}


async function createTemporaryVideoReadUrl(
  pathname
) {
  const {
    issueSignedToken,
    presignUrl
  } =
    await loadBlobSignedUrlFunctions();

  const validUntil =
    Date.now() +
    SIGNED_URL_LIFETIME_MS;

  let signedToken;

  try {
    signedToken =
      await issueSignedToken({
        pathname,

        operations: [
          "get"
        ],

        validUntil
      });
  } catch (error) {
    throw new Error(
      `BLOB_SIGNED_TOKEN_FAILED: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  if (
    !signedToken ||
    !signedToken.clientSigningToken ||
    !signedToken.delegationToken
  ) {
    throw new Error(
      "BLOB_SIGNED_TOKEN_FAILED: Vercel Blob did not return signing credentials."
    );
  }

  let signed;

  try {
    /*
     * access: "private" is essential.
     *
     * Without it, the generated hostname can become:
     * <store>.undefined.blob.vercel-storage.com
     */
    signed =
      await presignUrl(
        signedToken,
        {
          operation:
            "get",

          pathname,

          access:
            "private",

          validUntil
        }
      );
  } catch (error) {
    throw new Error(
      `BLOB_PRESIGN_FAILED: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  const url =
    signed?.presignedUrl;

  if (
    typeof url !==
      "string" ||
    !url.startsWith(
      "https://"
    )
  ) {
    throw new Error(
      "BLOB_PRESIGN_FAILED: Vercel Blob returned no usable presigned URL."
    );
  }

  if (
    url.includes(
      ".undefined.blob.vercel-storage.com"
    )
  ) {
    throw new Error(
      "BLOB_PRESIGN_FAILED: Vercel Blob returned an invalid .undefined hostname."
    );
  }

  if (
    !url.includes(
      ".private.blob.vercel-storage.com"
    )
  ) {
    throw new Error(
      "BLOB_PRESIGN_FAILED: Vercel Blob did not return a private Blob hostname."
    );
  }

  return url;
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
    req.method !==
    "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res
      .status(405)
      .json({
        error:
          "Method not allowed"
      });
  }

  const replicateToken =
    process.env
      .REPLICATE_API_TOKEN;

  if (
    !replicateToken
  ) {
    return res
      .status(500)
      .json({
        error:
          "REPLICATE_API_TOKEN is not configured"
      });
  }

  const {
    pathname:
      rawPathname,

    target_resolution,

    target_fps,

    scene
  } =
    req.body || {};

  const pathname =
    cleanPathname(
      rawPathname
    );

  if (
    !pathname
  ) {
    return res
      .status(400)
      .json({
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

  const requestedFps =
    Number(
      target_fps
    );

  const fps =
    ALLOWED_FPS.has(
      requestedFps
    )
      ? requestedFps
      : 30;

  const selectedScene =
    ALLOWED_SCENES.has(
      scene
    )
      ? scene
      : "common";

  try {
    /*
     * Create temporary read-only access
     * to the private source video.
     */
    const videoUrl =
      await createTemporaryVideoReadUrl(
        pathname
      );

    console.log(
      "FACEVOL VIDEO ENHANCE SIGNED INPUT READY:",
      pathname,
      resolution,
      `${fps}fps`,
      selectedScene
    );

    /*
     * Do not log videoUrl.
     * It contains temporary credentials.
     */

    const response =
      await fetch(
        "https://api.replicate.com/v1/models/bytedance/video-upscaler/predictions",
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json",

            /*
             * Enhancement itself may run for
             * several minutes on Replicate.
             */
            "Cancel-After":
              "30m"
          },

          /*
           * No "Prefer: wait=60".
           * Replicate should return a prediction
           * ID immediately and FaceEvol polls it.
           */
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
      const raw =
        await response
          .text()
          .catch(
            () => ""
          );

      return sendError(
        res,
        response.status || 502,
        "Replicate returned a non-JSON response.",
        raw ||
          `HTTP ${response.status}`
      );
    }

    if (
      !response.ok
    ) {
      const details =
        prediction?.detail ||
        prediction?.error ||
        prediction ||
        `Replicate HTTP ${
          response.status
        }`;

      console.error(
        "FaceEvol video enhancement Replicate request failed:",
        response.status,
        safeDetail(details)
      );

      return sendError(
        res,
        response.status,
        "Video enhancement request failed.",
        details
      );
    }

    if (
      !prediction ||
      typeof prediction !==
        "object"
    ) {
      return sendError(
        res,
        502,
        "Video enhancement returned an invalid response.",
        prediction
      );
    }

    if (
      !prediction.id
    ) {
      return sendError(
        res,
        502,
        "Video enhancement did not return a prediction ID.",
        prediction
      );
    }

    console.log(
      "FACEVOL VIDEO ENHANCE STARTED:",
      prediction.id,
      prediction.status,
      resolution,
      `${fps}fps`,
      selectedScene
    );

    return res
      .status(200)
      .json({
        success:
          true,

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
        "BLOB_SDK_LOAD_FAILED:"
      )
    ) {
      return sendError(
        res,
        500,
        "FaceEvol could not load the Vercel Blob SDK.",
        message
      );
    }

    if (
      message.startsWith(
        "BLOB_SDK_EXPORTS_MISSING:"
      )
    ) {
      return sendError(
        res,
        500,
        "The deployed Vercel Blob SDK is missing signed-URL support.",
        message
      );
    }

    if (
      message.startsWith(
        "BLOB_SIGNED_TOKEN_FAILED:"
      )
    ) {
      return sendError(
        res,
        500,
        "FaceEvol could not authorize temporary video access.",
        message
      );
    }

    if (
      message.startsWith(
        "BLOB_PRESIGN_FAILED:"
      )
    ) {
      return sendError(
        res,
        500,
        "FaceEvol could not create temporary video access.",
        message
      );
    }

    return sendError(
      res,
      500,
      "Could not start video enhancement.",
      message
    );
  }
}
