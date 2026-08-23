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

  if (
    !face ||
    typeof face !== "string" ||
    !face.startsWith("data:image/")
  ) {
    return res.status(400).json({
      error: "A valid face image is required"
    });
  }

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

    const pathname =
      decodeURIComponent(
        blobUrl.pathname.slice(1)
      );

    if (!pathname) {
      return res.status(400).json({
        error: "Invalid video pathname"
      });
    }

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
        "/api/video",
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
            "application/json",

          Prefer: "wait"
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

    const prediction =
      await response.json();

    if (!response.ok) {
      return res
        .status(response.status)
        .json({
          error:
            "Replicate face swap request failed",

          details:
            prediction
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
      details: error.message
    });
  }
}
