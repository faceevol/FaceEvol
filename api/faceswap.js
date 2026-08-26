// Trigger Vercel deployment
import { createHmac } from "node:crypto";

function createSignature(pathname, expires, secret) {
  return createHmac("sha256", secret)
    .update(`${pathname}:${expires}`)
    .digest("hex");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const replicateToken =
    process.env.REPLICATE_API_TOKEN;

  if (!replicateToken) {
    return res.status(500).json({
      error: "REPLICATE_API_TOKEN is not configured"
    });
  }

  const { face, video } = req.body || {};

  // Validate face image
  if (
    !face ||
    typeof face !== "string" ||
    !face.startsWith("data:image/")
  ) {
    return res.status(400).json({
      error: "A valid face image is required"
    });
  }

  // Extra protection.
  // The browser should already compress the image,
  // but reject unexpectedly huge data if something goes wrong.
  if (face.length > 3_000_000) {
    return res.status(413).json({
      error:
        "The face image is still too large after optimization. Please try another image."
    });
  }

  // Validate uploaded video URL
  if (
    !video ||
    typeof video !== "string" ||
    !video.startsWith("https://")
  ) {
    return res.status(400).json({
      error: "A valid video URL is required"
    });
  }

  try {
    const blobUrl = new URL(video);

    // Only allow Vercel Blob URLs
    if (
      !blobUrl.hostname.endsWith(
        ".blob.vercel-storage.com"
      )
    ) {
      return res.status(400).json({
        error: "Invalid video storage URL"
      });
    }

    const pathname =
      decodeURIComponent(
        blobUrl.pathname.slice(1)
      );

    if (!pathname) {
      return res.status(400).json({
        error: "Invalid video pathname"
      });
    }

    // Give Replicate 30 minutes to access
    // the private source video.
    const expires =
      String(
        Date.now() +
        30 * 60 * 1000
      );

    const signature =
      createSignature(
        pathname,
        expires,
        replicateToken
      );

    const proxyUrl =
      new URL(
        "/api/video.mp4",
        "https://www.faceevol.com"
      );

    proxyUrl.searchParams.set(
      "pathname",
      pathname
    );

    proxyUrl.searchParams.set(
      "expires",
      expires
    );

    proxyUrl.searchParams.set(
      "signature",
      signature
    );

    const response = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${replicateToken}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          version:
            "104b4a39315349db50880757bc8c1c996c5309e3aa11286b0a3c84dab81fd440",

          input: {
            source:
              proxyUrl.toString(),

            target:
              face
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
        "Replicate face swap error:",
        prediction
      );

      return res
        .status(response.status)
        .json({
          error:
            prediction?.detail ||
            prediction?.error ||
            "Replicate face swap request failed",

          details:
            prediction
        });
    }

    if (!prediction?.id) {
      console.error(
        "Replicate returned no prediction ID:",
        prediction
      );

      return res.status(502).json({
        error:
          "Face swap service returned an invalid response."
      });
    }

    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    console.error(
      "Face swap server error:",
      error
    );

    return res.status(500).json({
      error: "Server error",
      details:
        error instanceof Error
          ? error.message
          : String(error)
    });
  }
}
