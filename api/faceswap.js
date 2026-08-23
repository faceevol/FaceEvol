export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const token = process.env.REPLICATE_API_TOKEN;

  if (!token) {
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
    !video.startsWith("data:video/")
  ) {
    return res.status(400).json({
      error: "A valid video is required"
    });
  }

  try {
    const response = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "wait"
        },
        body: JSON.stringify({
          version:
            "104b4a39315349db50880757bc8c1c996c5309e3aa11286b0a3c84dab81fd440",
          input: {
            source: video,
            target: face
          }
        })
      }
    );

    const prediction = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Replicate face swap request failed",
        details: prediction
      });
    }

    return res.status(200).json({
      success: true,
      prediction
    });

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
