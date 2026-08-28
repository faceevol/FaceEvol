/*
 * FaceEvol Video Enhance
 * Save as: /api/video-enhance.js
 *
 * Model:
 * philz1337x/crystal-video-upscaler
 *
 * Crystal is optimized for:
 * - people
 * - portraits
 * - faces
 * - natural skin detail
 *
 * Existing FaceEvol private Vercel Blob
 * signed-URL flow is preserved.
 */

const ALLOWED_RESOLUTIONS =
  new Set([
    "1080p",
    "4k"
  ]);

const SIGNED_URL_LIFETIME_MS =
  2 * 60 * 60 * 1000;


/*
 * Convert the existing FaceEvol quality selector
 * into Crystal's scale_factor.
 *
 * 1080p option -> 2x upscale
 * 4K option    -> 4x upscale, capped by Crystal at 4K
 */
function getScaleFactor(
  targetResolution
) {
  if (
    targetResolution === "4k"
  ) {
    return 4;
  }

  return 2;
}


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


/*
 * Load Vercel Blob's
 * signed/private URL functions.
 */
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


/*
 * Create temporary GET-only access
 * to the private uploaded video.
 */
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
    typeof url !== "string" ||
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


/*
 * Main FaceEvol endpoint.
 */
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

  /*
   * Keep accepting the same frontend
   * parameters so index.html does not
   * need to change for this test.
   *
   * target_fps is intentionally ignored.
   * Crystal preserves the source video
   * instead of generating artificial FPS.
   */
  const {
    pathname: rawPathname,
    target_resolution
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
      : "4k";

  const scaleFactor =
    getScaleFactor(
      resolution
    );

  try {
    /*
     * Give Replicate temporary
     * read-only access to this
     * private video.
     */
    const videoUrl =
      await createTemporaryVideoReadUrl(
        pathname
      );

    console.log(
      "FACEVOL CRYSTAL VIDEO INPUT READY:",
      pathname,
      resolution,
      `${scaleFactor}x`
    );

    /*
     * Start Crystal asynchronously.
     *
     * FaceEvol's existing
     * /api/prediction.js continues
     * polling the prediction.
     */
    const response =
      await fetch(
        "https://api.replicate.com/v1/models/philz1337x/crystal-video-upscaler/predictions",
        {
          method:
            "POST",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json",

            /*
             * Video enhancement can
             * take several minutes.
             */
            "Cancel-After":
              "30m"
          },

          body:
            JSON.stringify({
              input: {
                video:
                  videoUrl,

                scale_factor:
                  scaleFactor
              }
            })
        }
      );

    const responseText =
      await response.text();

    let prediction = {};

    if (
      responseText
    ) {
      try {
        prediction =
          JSON.parse(
            responseText
          );
      } catch {
        return sendError(
          res,
          response.status ||
            502,

          "Crystal returned a non-JSON response.",

          responseText
        );
      }
    }

    if (
      !response.ok
    ) {
      const details =
        prediction?.detail ||
        prediction?.error ||
        prediction ||
        `Replicate HTTP ${response.status}`;

      console.error(
        "FaceEvol Crystal request failed:",
        response.status,
        safeDetail(
          details
        )
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

        "Crystal returned an invalid prediction response.",

        prediction
      );
    }

    if (
      !prediction.id
    ) {
      return sendError(
        res,
        502,

        "Crystal did not return a prediction ID.",

        prediction
      );
    }

    console.log(
      "FACEVOL CRYSTAL ENHANCEMENT STARTED:",
      prediction.id,
      prediction.status,
      resolution,
      `${scaleFactor}x`
    );

    return res
      .status(200)
      .json({
        success:
          true,

        model:
          "philz1337x/crystal-video-upscaler",

        settings: {
          target_resolution:
            resolution,

          scale_factor:
            scaleFactor
        },

        prediction
      });

  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "FaceEvol Crystal enhancement server error:",
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

      "Could not start Crystal video enhancement.",

      message
    );
  }
}
