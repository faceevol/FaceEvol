/*
 * FaceEvol Video Enhance
 * Save as:
 * /api/video-enhance.js
 *
 * Model:
 * bytedance/video-upscaler
 *
 * Test configuration:
 * - Try PRO first
 * - Automatically fall back to STANDARD if PRO is unavailable
 * - Supports 1080p / 2K / 4K
 * - Optimized for real-person / UGC video
 * - Keeps FaceEvol private-video proxy flow
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
 * Only accept FaceEvol temporary
 * private video pathnames.
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


/*
 * Start one ByteDance prediction.
 */
async function startPrediction({
  token,
  videoUrl,
  processingType,
  scene,
  resolution,
  fps
}) {

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
           * Allow long processing on Replicate.
           *
           * We intentionally DO NOT use
           * Prefer: wait=60 here.
           *
           * FaceEvol already polls the
           * prediction endpoint.
           */
          "Cancel-After":
            "30m"
        },

        body:
          JSON.stringify({
            input: {
              video:
                videoUrl,

              processing_type:
                processingType,

              scene,

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
        JSON.parse(
          responseText
        );
    } catch {
      prediction = {
        detail:
          responseText
      };
    }
  }


  return {
    response,
    prediction
  };
}


/*
 * Decide whether failure is specifically
 * related to PRO access.
 */
function shouldFallbackToStandard(
  response,
  prediction
) {

  if (
    ![
      400,
      403,
      422
    ].includes(
      response.status
    )
  ) {
    return false;
  }


  const detail =
    safeDetail(
      prediction?.detail ||
      prediction?.error ||
      prediction
    ).toLowerCase();


  return (
    detail.includes("pro") ||
    detail.includes("allowlist") ||
    detail.includes("allow list") ||
    detail.includes("permission") ||
    detail.includes("processing_type")
  );
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


  const token =
    process.env
      .REPLICATE_API_TOKEN;


  if (!token) {

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

  } = req.body || {};


  const pathname =
    cleanPathname(
      rawPathname
    );


  if (!pathname) {

    return res
      .status(400)
      .json({
        error:
          "A valid FaceEvol video upload is required."
      });
  }


  /*
   * 4K becomes the default for this test.
   *
   * If the frontend explicitly sends
   * 1080p / 2k / 4k, that choice is
   * still respected.
   */
  const resolution =
    ALLOWED_RESOLUTIONS.has(
      target_resolution
    )
      ? target_resolution
      : "4k";


  /*
   * Keep 30 FPS as default.
   * This gives us a cleaner quality test
   * without spending processing on
   * unnecessary frame interpolation.
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
   * UGC is our preferred preset
   * for FaceEvol real-person videos.
   */
  const selectedScene =
    ALLOWED_SCENES.has(
      scene
    )
      ? scene
      : "ugc";


  /*
   * Keep the original Vercel Blob private.
   *
   * Replicate receives only FaceEvol's
   * controlled streaming URL.
   */
  const videoUrl =
    `https://www.faceevol.com/api/video.mp4?pathname=${encodeURIComponent(
      pathname
    )}`;


  try {

    console.log(
      "FACEVOL BYTEDANCE TEST:",
      resolution,
      `${fps}fps`,
      selectedScene
    );


    /*
     * ---------------------------------
     * ATTEMPT 1:
     * ByteDance PRO
     * ---------------------------------
     *
     * PRO is the quality mode we actually
     * want to test for people / faces.
     */
    let {
      response,
      prediction

    } =
      await startPrediction({
        token,

        videoUrl,

        processingType:
          "pro",

        scene:
          selectedScene,

        resolution,

        fps
      });


    let processingType =
      "pro";


    /*
     * If this Replicate account
     * cannot access PRO, retry once
     * using STANDARD.
     */
    if (
      !response.ok &&
      shouldFallbackToStandard(
        response,
        prediction
      )
    ) {

      console.warn(
        "ByteDance PRO unavailable. Retrying with STANDARD."
      );


      const fallback =
        await startPrediction({
          token,

          videoUrl,

          processingType:
            "standard",

          scene:
            selectedScene,

          resolution,

          fps
        });


      response =
        fallback.response;

      prediction =
        fallback.prediction;

      processingType =
        "standard";
    }


    /*
     * Final API error.
     */
    if (!response.ok) {

      const details =
        safeDetail(
          prediction?.detail ||
          prediction?.error ||
          prediction ||
          `Replicate HTTP ${response.status}`
        );


      console.error(
        "FaceEvol ByteDance request failed:",
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


    if (
      !prediction ||
      typeof prediction !==
        "object"
    ) {

      return res
        .status(502)
        .json({
          error:
            "ByteDance returned an invalid prediction response."
        });
    }


    if (
      !prediction.id
    ) {

      return res
        .status(502)
        .json({
          error:
            "ByteDance did not return a prediction ID.",

          details:
            safeDetail(
              prediction
            )
        });
    }


    console.log(
      "FACEVOL BYTEDANCE STARTED:",
      prediction.id,
      prediction.status,
      processingType,
      resolution,
      `${fps}fps`,
      selectedScene
    );


    return res
      .status(200)
      .json({

        success:
          true,

        model:
          "bytedance/video-upscaler",

        settings: {
          processing_type:
            processingType,

          scene:
            selectedScene,

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
      "FaceEvol ByteDance enhancement server error:",
      message
    );


    return res
      .status(500)
      .json({
        error:
          "Could not start ByteDance video enhancement.",

        details:
          message
      });
  }
}
