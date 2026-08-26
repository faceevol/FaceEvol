import { del } from "@vercel/blob";

function getTemporaryVideoPathname(prediction) {
  try {
    const source =
      prediction?.input?.source;

    if (
      typeof source !== "string" ||
      !source.startsWith("https://")
    ) {
      return null;
    }

    const sourceUrl =
      new URL(source);

    // Only accept our own private-video proxy.
    if (
      sourceUrl.hostname !== "www.faceevol.com" ||
      sourceUrl.pathname !== "/api/video.mp4"
    ) {
      return null;
    }

    const pathname =
      sourceUrl.searchParams.get(
        "pathname"
      );

    if (!pathname) {
      return null;
    }

    return pathname;

  } catch {
    return null;
  }
}


async function cleanupTemporaryVideo(prediction) {
  const pathname =
    getTemporaryVideoPathname(
      prediction
    );

  if (!pathname) {
    return;
  }

  try {
    await del(pathname);

    console.log(
      "Deleted temporary FaceEvol video:",
      pathname
    );

  } catch (error) {

    /*
     * Cleanup failure should NOT make
     * a successful face swap appear failed.
     *
     * It may also happen if another poll
     * already deleted the same temporary file.
     */

    console.warn(
      "Temporary video cleanup skipped/failed:",
      pathname,
      error instanceof Error
        ? error.message
        : String(error)
    );
  }
}


export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }


  const replicateToken =
    process.env.REPLICATE_API_TOKEN;


  if (!replicateToken) {
    return res.status(500).json({
      error:
        "REPLICATE_API_TOKEN is not configured"
    });
  }


  const { id } =
    req.query || {};


  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9]+$/.test(id)
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
        .status(response.status)
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


    /*
     * Once Replicate is completely finished,
     * it no longer needs the uploaded source video.
     *
     * Delete our temporary private Blob copy.
     */

    const isFinished =
      prediction.status === "succeeded" ||
      prediction.status === "failed" ||
      prediction.status === "canceled";


    if (isFinished) {
      await cleanupTemporaryVideo(
        prediction
      );
    }


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    return res.status(200).json({

      id:
        prediction.id,

      status:
        prediction.status,

      output:
        prediction.output || null,

      error:
        prediction.error || null

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
