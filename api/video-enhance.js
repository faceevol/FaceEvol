/*
 * FaceEvol Video Enhance
 * Save as: /api/video-enhance.js
 *
 * QUALITY TEST:
 * - 2K output
 * - 30 FPS
 * - UGC scene
 * - Standard processing
 *
 * Model:
 * bytedance/video-upscaler
 */

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
    return JSON.stringify(value)
      .slice(0, 2000);
  } catch {
    return String(value)
      .slice(0, 2000);
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
      `BLOB_SDK_EXPORTS_MISSING: ` +
      `issueSignedToken/presignUrl are unavailable. ` +
      `Exports found: ${exportsFound}`
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
      "BLOB_SIGNED_TOKEN_FAILED: " +
      "Vercel Blob did not return signing credentials."
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
    !url.startsWith("https://")
  ) {

    throw new Error(
      "BLOB_PRESIGN_FAILED: " +
      "Vercel Blob returned no usable presigned URL."
    );
  }


  if (
    url.includes(
      ".undefined.blob.vercel-storage.com"
    )
  ) {

    throw new Error(
      "BLOB_PRESIGN_FAILED: " +
      "Vercel Blob returned an invalid hostname."
    );
  }


  if (
    !url.includes(
      ".private.blob.vercel-storage.com"
    )
  ) {

    throw new Error(
      "BLOB_PRESIGN_FAILED: " +
      "Vercel Blob did not return a private Blob hostname."
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
      rawPathname
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


  /*
   * QUALITY TEST SETTINGS
   *
   * We deliberately force these values
   * so that we're testing the exact same
   * enhancement configuration every time.
   */

  const resolution =
    "2k";

  const fps =
    30;

  const selectedScene =
    "ugc";


  try {

    /*
     * Give Replicate temporary GET access
     * to this PRIVATE source video.
     */

    const videoUrl =
      await createTemporaryVideoReadUrl(
        pathname
      );


    console.log(
      "FACEVOL VIDEO ENHANCE TEST:",
      pathname,
      "2K",
      "30 FPS",
      "UGC",
      "STANDARD"
    );


    /*
     * Start ByteDance Video Upscaler.
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

            "Cancel-After":
              "30m"
          },


          body:
            JSON.stringify({
              input: {

                video:
                  videoUrl,


                /*
                 * Keep STANDARD for now.
                 *
                 * We know this mode works with
                 * the current FaceEvol account.
                 */
                processing_type:
                  "standard",


                /*
                 * UGC is intended for
                 * ordinary phone/social video.
                 */
                scene:
                  "ugc",


                /*
                 * Force 2K.
                 */
                target_resolution:
                  "2k",


                /*
                 * Force 30 FPS.
                 *
                 * Avoid frame interpolation
                 * while testing sharpness.
                 */
                target_fps:
                  30
              }
            })
        }
      );


    const responseText =
      await response.text();


    let prediction =
      null;


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
          response.status || 502,
          "Replicate returned a non-JSON response.",
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
        "FaceEvol video enhancement request failed:",
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
      "FACEVOL 2K ENHANCEMENT STARTED:",
      prediction.id,
      prediction.status
    );


    return res
      .status(200)
      .json({

        success:
          true,


        /*
         * Useful during this test so
         * we know exactly what ran.
         */

        settings: {
          processing_type:
            "standard",

          target_resolution:
            "2k",

          target_fps:
            30,

          scene:
            "ugc"
        },


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
