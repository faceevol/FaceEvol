import {
  del
} from "@vercel/blob";


function extractTemporaryPathname(
  proxyUrlString,
  expectedRoute,
  expectedPrefix
) {
  try {
    if (
      typeof proxyUrlString !==
        "string" ||
      !proxyUrlString.startsWith(
        "https://"
      )
    ) {
      return null;
    }


    const url =
      new URL(
        proxyUrlString
      );


    /*
     * Only accept URLs generated
     * by our own FaceEvol proxy.
     */
    if (
      url.hostname !==
        "www.faceevol.com" ||
      url.pathname !==
        expectedRoute
    ) {
      return null;
    }


    const pathname =
      url.searchParams.get(
        "pathname"
      );


    if (
      !pathname ||
      !pathname.startsWith(
        expectedPrefix
      )
    ) {
      return null;
    }


    return pathname;

  } catch {
    return null;
  }
}


async function cleanupPredictionInputs(
  prediction
) {
  const facePathname =
    extractTemporaryPathname(
      prediction?.input?.target,
      "/api/image.jpg",
      "faceevol-face-"
    );


  const videoPathname =
    extractTemporaryPathname(
      prediction?.input?.source,
      "/api/video.mp4",
      "faceevol-video-"
    );


  const pathnames =
    [
      facePathname,
      videoPathname
    ].filter(Boolean);


  if (!pathnames.length) {
    console.warn(
      "No temporary FaceEvol inputs found for cleanup."
    );

    return;
  }


  try {
    /*
     * Vercel Blob del() accepts
     * multiple pathnames.
     */
    await del(
      pathnames
    );


    console.log(
      "Deleted temporary FaceEvol inputs:",
      pathnames
    );

  } catch (error) {
    /*
     * Cleanup failure must never
     * hide a successful face swap.
     */
    console.warn(
      "Temporary Blob cleanup failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}


export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
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
    id
  } =
    req.query || {};


  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9]+$/.test(
      id
    )
  ) {
    return res.status(400).json({
      error:
        "A valid prediction ID is required"
    });
  }


  try {
    const response =
      await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        {
          method: "GET",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json"
          }
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
      return res
        .status(
          response.status
        )
        .json({
          error:
            "Failed to retrieve prediction",

          details:
            prediction
        });
    }


    if (!prediction) {
      return res.status(502).json({
        error:
          "Replicate returned an invalid prediction response"
      });
    }


    console.log(
      "FACEVOL PREDICTION STATUS:",
      prediction.status
    );


    console.log(
      "FACEVOL RAW OUTPUT:",
      JSON.stringify(
        prediction.output
      )
    );


    console.log(
      "FACEVOL PREDICTION ERROR:",
      prediction.error || null
    );


    const finished =
      prediction.status ===
        "succeeded" ||
      prediction.status ===
        "failed" ||
      prediction.status ===
        "canceled";


    /*
     * Replicate is finished with
     * the source files, so remove
     * the temporary private Blobs.
     */
    if (finished) {
      await cleanupPredictionInputs(
        prediction
      );
    }


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    return res
      .status(200)
      .json({
        id:
          prediction.id,

        status:
          prediction.status,

        output:
          prediction.output ??
          null,

        error:
          prediction.error ??
          null
      });

  } catch (error) {
    console.error(
      "Prediction status error:",
      error
    );


    return res.status(500).json({
      error:
        "Server error",

      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
