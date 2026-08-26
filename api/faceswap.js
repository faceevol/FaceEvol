import {
  createHmac
} from "node:crypto";

import {
  del
} from "@vercel/blob";


function createSignature(
  pathname,
  expires,
  secret
) {
  return createHmac(
    "sha256",
    secret
  )
    .update(
      `${pathname}:${expires}`
    )
    .digest("hex");
}


function getBlobPathname(
  blobUrlString,
  requiredPrefix
) {
  const blobUrl =
    new URL(
      blobUrlString
    );


  /*
   * Require Vercel Blob storage.
   */
  if (
    !blobUrl.hostname.endsWith(
      ".blob.vercel-storage.com"
    )
  ) {
    throw new Error(
      "Invalid Blob storage URL"
    );
  }


  const pathname =
    decodeURIComponent(
      blobUrl.pathname.slice(1)
    );


  if (
    !pathname ||
    !pathname.startsWith(
      requiredPrefix
    )
  ) {
    throw new Error(
      "Invalid Blob pathname"
    );
  }


  return pathname;
}


function buildSignedProxyUrl(
  route,
  pathname,
  expires,
  secret
) {
  const signature =
    createSignature(
      pathname,
      expires,
      secret
    );


  const url =
    new URL(
      route,
      "https://www.faceevol.com"
    );


  url.searchParams.set(
    "pathname",
    pathname
  );


  url.searchParams.set(
    "expires",
    expires
  );


  url.searchParams.set(
    "signature",
    signature
  );


  return url.toString();
}


async function cleanupInputs(
  pathnames
) {
  const safe =
    pathnames.filter(Boolean);


  if (!safe.length) {
    return;
  }


  try {
    await del(safe);

    console.log(
      "Cleaned temporary FaceEvol inputs:",
      safe
    );

  } catch (error) {
    console.warn(
      "Temporary input cleanup failed:",
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
    req.method !== "POST"
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


  /*
   * face and video are now PRIVATE
   * Vercel Blob URLs.
   *
   * The face is NOT Base64 anymore.
   */
  const {
    face,
    video
  } =
    req.body || {};


  if (
    typeof face !== "string" ||
    !face.startsWith(
      "https://"
    )
  ) {
    return res.status(400).json({
      error:
        "A valid face image URL is required"
    });
  }


  if (
    typeof video !== "string" ||
    !video.startsWith(
      "https://"
    )
  ) {
    return res.status(400).json({
      error:
        "A valid video URL is required"
    });
  }


  let facePathname = null;
  let videoPathname = null;


  try {
    facePathname =
      getBlobPathname(
        face,
        "faceevol-face-"
      );


    videoPathname =
      getBlobPathname(
        video,
        "faceevol-video-"
      );


    /*
     * Replicate gets 30 minutes
     * to retrieve the temporary files.
     */
    const expires =
      String(
        Date.now() +
        30 * 60 * 1000
      );


    const imageProxyUrl =
      buildSignedProxyUrl(
        "/api/image.jpg",
        facePathname,
        expires,
        replicateToken
      );


    const videoProxyUrl =
      buildSignedProxyUrl(
        "/api/video.mp4",
        videoPathname,
        expires,
        replicateToken
      );


    console.log(
      "Starting FaceEvol prediction"
    );


    console.log(
      "Face input proxy:",
      imageProxyUrl
        .replace(
          /signature=[^&]+/,
          "signature=HIDDEN"
        )
    );


    console.log(
      "Video input proxy:",
      videoProxyUrl
        .replace(
          /signature=[^&]+/,
          "signature=HIDDEN"
        )
    );


    const response =
      await fetch(
        "https://api.replicate.com/v1/predictions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${replicateToken}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              version:
                "104b4a39315349db50880757bc8c1c996c5309e3aa11286b0a3c84dab81fd440",

              input: {
                source:
                  videoProxyUrl,

                target:
                  imageProxyUrl
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
      console.error(
        "Replicate face swap request failed:",
        prediction
      );


      /*
       * Replicate never successfully
       * started, so it does not need
       * these files anymore.
       */
      await cleanupInputs([
        facePathname,
        videoPathname
      ]);


      return res
        .status(
          response.status
        )
        .json({
          error:
            prediction?.detail ||
            prediction?.error ||
            "Replicate face swap request failed",

          details:
            prediction
        });
    }


    if (
      !prediction?.id
    ) {
      console.error(
        "Replicate returned no prediction ID:",
        prediction
      );


      await cleanupInputs([
        facePathname,
        videoPathname
      ]);


      return res
        .status(502)
        .json({
          error:
            "Face swap service returned an invalid response."
        });
    }


    console.log(
      "FaceEvol prediction created:",
      prediction.id
    );


    return res
      .status(200)
      .json({
        success: true,
        prediction
      });

  } catch (error) {
    console.error(
      "Face swap server error:",
      error
    );


    /*
     * If we already know which
     * temporary files belong to
     * this request, remove them.
     */
    await cleanupInputs([
      facePathname,
      videoPathname
    ]);


    return res
      .status(500)
      .json({
        error:
          "Server error",

        details:
          error instanceof Error
            ? error.message
            : String(error)
      });
  }
}
