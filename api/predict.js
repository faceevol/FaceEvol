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

  const { image, target_age } = req.body || {};
const age = Number(target_age);

if (
  !image ||
  typeof image !== "string" ||
  !image.startsWith("data:image/")
) {
  return res.status(400).json({
    error: "A valid image is required"
  });
}

if (
  !Number.isFinite(age) ||
  age < 0 ||
  age > 100
) {
  return res.status(400).json({
    error: "Target age must be between 0 and 100"
  });
}

// Prevent very large uploads from consuming unnecessary resources.
// Roughly limits the original image to about 8 MB.
if (image.length > 11_000_000) {
  return res.status(413).json({
    error: "Image is too large. Please use an image under 8 MB."
  });
}
  if (!image) {
    return res.status(400).json({
      error: "Image is required"
    });
  }

  if (target_age === undefined || target_age === null) {
    return res.status(400).json({
      error: "Target age is required"
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
            "9222a21c181b707209ef12b5e0d7e94c994b58f01c7b2fec075d2e892362f13c",
          input: {
            image: image,
            target_age: String(target_age)
          }
        })
      }
    );

    const prediction = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Replicate request failed",
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
