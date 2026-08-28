/*
 * FaceEvol Video Enhance
 * Save as: /api/video-enhance.js
 *
 * Model:
 * topazlabs/video-upscale
 *
 * FaceEvol keeps the existing private-upload + signed-URL flow.
 * The only model inputs Topaz needs are:
 * - video
 * - target_resolution
 * - target_fps
 */

const ALLOWED_RESOLUTIONS =
  new Set([
    "1080p",
    "4k"
  ]);

const ALLOWED_FPS =
  new Set([
    30,
    60
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
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.slice(0, 2000);
  }

  try {
    return JSON.stringify(value).slice(0, 2000);
  } catch {
    return String(value).slice(0, 2000);
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
      details: safeDetail(details)
    });
}


async function loadBlobSignedUrlFunctions() {
  let blobSdk;

  try {
    blobSdk =
      await import("@vercel/blob");
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
    typeof issueSignedToken !== "function" ||
    typeof presignUrl !== "function"
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
        operations: ["get"],
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
    signed =
      await presignUrl(
        signedToken,
        {
          operation: "get",
          pathname,
          access: "private",
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
    typeof url !== "string" ||
    !url.startsWith("https://")
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
      "BLOB_PRESIGN_FAILED: Vercel Blob returned an invalid hostname."
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
    req.method !== "POST"
  ) {
    res.setHeader(
      "Allow",
      "POST"
    );

    return res
      .status(405)
      .json({
        error: "Method not allowed"
      });
  }

  const replicateToken =
    process.env.REPLICATE_API_TOKEN;

  if (!replicateToken) {
    return res
      .status(500)
      .json({
        error:
          "REPLICATE_API_TOKEN is not configured"
      });
  }

  const {
    pathname: rawPathname,
    target_resolution,
    target_fps
  } =
    req.body || {};

  const pathname =
    cleanPathname(rawPathname);

  if (!pathname) {
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
      : "4k";

  const requestedFps =
    Number(target_fps);

  const fps =
    ALLOWED_FPS.has(
      requestedFps
    )
      ? requestedFps
      : 30;

  try {
    /*
     * Replicate receives temporary GET-only access
     * to this one private uploaded clip.
     */
    const videoUrl =
      await createTemporaryVideoReadUrl(
        pathname
      );

    console.log(
      "FACEVOL TOPAZ VIDEO ENHANCE INPUT READY:",
      pathname,
      resolution,
      `${fps}fps`
    );

    /*
     * Start Topaz asynchronously.
     * No Prefer: wait header: FaceEvol already polls /api/prediction.js.
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/models/topazlabs/video-upscale/predictions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json",

            /*
             * 4K video processing can take several minutes.
             */
            "Cancel-After":
              "30m"
          },

          body:
            JSON.stringify({
              input: {
                video:
                  videoUrl,

                target_resolution:
                  resolution,

                target_fps:
                  fps
              }
            })
        }
      );

    const responseText =
      await response.text();

    let prediction = {};

    if (responseText) {
      try {
        prediction =
          JSON.parse(responseText);
      } catch {
        return sendError(
          res,
          response.status || 502,
          "Topaz returned a non-JSON response.",
          responseText
        );
      }
    }

    if (!response.ok) {
      const details =
        prediction?.detail ||
        prediction?.error ||
        prediction ||
        `Replicate HTTP ${response.status}`;

      console.error(
        "FaceEvol Topaz request failed:",
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
      typeof prediction !== "object"
    ) {
      return sendError(
        res,
        502,
        "Topaz returned an invalid prediction response.",
        prediction
      );
    }

    if (!prediction.id) {
      return sendError(
        res,
        502,
        "Topaz did not return a prediction ID.",
        prediction
      );
    }

    console.log(
      "FACEVOL TOPAZ ENHANCEMENT STARTED:",
      prediction.id,
      prediction.status,
      resolution,
      `${fps}fps`
    );

    return res
      .status(200)
      .json({
        success: true,

        model:
          "topazlabs/video-upscale",

        settings: {
          target_resolution:
            resolution,

          target_fps:
            fps
        },

        prediction
      });

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "FaceEvol Topaz enhancement server error:",
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
      "Could not start Topaz video enhancement.",
      message
    );
  }
}
