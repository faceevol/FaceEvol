import {
  head,
  issueSignedToken,
  presignUrl
} from "@vercel/blob";

/*
 * FaceEvol Video Enhance
 * Save as:
 * /api/video-enhance.js
 *
 * Model:
 * bytedance/video-upscaler
 *
 * Flow:
 * 1. User's MP4 is stored privately in Vercel Blob.
 * 2. FaceEvol creates a temporary GET-only signed URL.
 * 3. Replicate receives that temporary URL.
 * 4. Replicate starts the enhancement asynchronously.
 * 5. Frontend polls /api/prediction.js until finished.
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


/*
 * Give Replicate two hours to access
 * the private source video.
 */
const SIGNED_URL_LIFETIME_MS =
  2 * 60 * 60 * 1000;


/*
 * Validate that the pathname belongs
 * to a FaceEvol temporary MP4.
 */
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


/*
 * Keep external error responses small
 * enough to safely return to the browser.
 */
function safeDetail(value) {
  if (!value) {
    return "";
  }

  if (
    typeof value === "string"
  ) {
    return value.slice(
      0,
      1600
    );
  }

  try {
    return JSON.stringify(
      value
    ).slice(
      0,
      1600
    );

  } catch {
    return String(
      value
    ).slice(
      0,
      1600
    );
  }
}


/*
 * Create temporary read-only access
 * for the private uploaded MP4.
 */
async function createTemporaryVideoReadUrl(
  pathname
) {
  let metadata;


  /*
   * First verify that the Blob
   * actually exists.
   */
  try {
    metadata =
      await head(
        pathname
      );

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


  /*
   * Reject an empty uploaded file.
   */
  if (
    metadata.size !==
      undefined &&
    metadata.size !==
      null &&
    Number(
      metadata.size
    ) <= 0
  ) {
    throw new Error(
      "PRIVATE_VIDEO_EMPTY: The uploaded video is empty."
    );
  }


  const validUntil =
    Date.now() +
    SIGNED_URL_LIFETIME_MS;


  /*
   * Issue a signed token that allows
   * GET access only to this pathname.
   */
  const signedToken =
    await issueSignedToken({
      pathname,

      operations: [
        "get"
      ],

      validUntil
    });


  /*
   * Turn the signed token into
   * a temporary URL Replicate can read.
   */
  const signed =
    await presignUrl(
      signedToken,
      {
        pathname,

        operation:
          "get",

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


  /*
   * Only POST is allowed.
   */
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


  /*
   * Replicate API key.
   */
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
   * Read options sent by index.html.
   */
  const {
    pathname:
      rawPathname,

    target_resolution,

    target_fps,

    scene

  } =
    req.body || {};


  /*
   * Validate video pathname.
   */
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
   * Validate resolution.
   *
   * If something unexpected arrives,
   * safely fall back to 1080p.
   */
  const resolution =
    ALLOWED_RESOLUTIONS.has(
      target_resolution
    )
      ? target_resolution
      : "1080p";


  /*
   * Validate target FPS.
   */
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


  /*
   * Validate enhancement preset.
   */
  const selectedScene =
    ALLOWED_SCENES.has(
      scene
    )
      ? scene
      : "common";


  try {

    /*
     * Create secure temporary access
     * to the private MP4.
     */
    const videoUrl =
      await createTemporaryVideoReadUrl(
        pathname
      );


    console.log(
      "FACEVOL VIDEO ENHANCE INPUT READY:",
      pathname,
      resolution,
      `${fps}fps`,
      selectedScene
    );


    /*
     * Start ByteDance Video Upscaler.
     *
     * IMPORTANT:
     *
     * There is intentionally NO:
     *
     * Prefer: "wait=60"
     *
     * This makes Replicate return the
     * prediction immediately instead
     * of holding this Vercel function
     * open while a 3–5+ minute video
     * enhancement runs.
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
             * Allow long enhancement
             * jobs on Replicate itself.
             */
            "Cancel-After":
              "30m"
          },

          body:
            JSON.stringify({
              input: {

                /*
                 * Temporary signed
                 * private video URL.
                 */
                video:
                  videoUrl,


                /*
                 * Standard works without
                 * Pro allowlist access.
                 */
                processing_type:
                  "standard",


                /*
                 * Scene-aware preset.
                 */
                scene:
                  selectedScene,


                /*
                 * 1080p / 2K / 4K
                 */
                target_resolution:
                  resolution,


                /*
                 * 30 / 60 FPS
                 */
                target_fps:
                  fps
              }
            })
        }
      );


    /*
     * Read Replicate response.
     */
    let prediction;


    try {
      prediction =
        await response.json();

    } catch {
      prediction =
        null;
    }


    /*
     * Replicate rejected the request.
     */
    if (
      !response.ok
    ) {
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
        .status(
          response.status
        )
        .json({
          error:
            "Video enhancement request failed.",

          details
        });
    }


    /*
     * Replicate should return a
     * prediction object containing
     * an ID and status.
     */
    if (
      !prediction ||
      typeof prediction !==
        "object"
    ) {
      return res
        .status(502)
        .json({
          error:
            "Video enhancement returned an invalid response."
        });
    }


    if (
      !prediction.id
    ) {
      console.error(
        "FaceEvol enhancement prediction has no ID:",
        prediction
      );

      return res
        .status(502)
        .json({
          error:
            "Video enhancement did not return a prediction ID."
        });
    }


    /*
     * This should normally be:
     *
     * starting
     * or
     * processing
     *
     * The frontend then polls
     * /api/prediction.js.
     */
    console.log(
      "FACEVOL VIDEO ENHANCE STARTED:",
      prediction.id,
      prediction.status,
      resolution,
      `${fps}fps`,
      selectedScene
    );


    /*
     * Immediately return prediction
     * to the browser.
     */
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


    /*
     * Private Blob missing.
     */
    if (
      message.startsWith(
        "PRIVATE_VIDEO_NOT_FOUND:"
      )
    ) {
      return res
        .status(404)
        .json({
          error:
            "FaceEvol could not read the private uploaded video.",

          details:
            message
        });
    }


    /*
     * Empty Blob.
     */
    if (
      message.startsWith(
        "PRIVATE_VIDEO_EMPTY:"
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "The uploaded video is empty.",

          details:
            message
        });
    }


    /*
     * Signed URL creation failed.
     */
    if (
      message.startsWith(
        "SIGNED_VIDEO_URL_FAILED:"
      )
    ) {
      return res
        .status(500)
        .json({
          error:
            "FaceEvol could not prepare secure AI access to the video.",

          details:
            message
        });
    }


    /*
     * Unknown server error.
     */
    return res
      .status(500)
      .json({
        error:
          "Could not start video enhancement.",

        details:
          message
      });
  }
}
