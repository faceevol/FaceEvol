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

  try {
    const response = await fetch(
      "https://api.replicate.com/v1/models",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      return res.status(response.status).json({
        error: "Could not connect to Replicate",
        details: errorText
      });
    }

    return res.status(200).json({
      success: true,
      message: "FaceEvol is securely connected to Replicate."
    });

  } catch (error) {
    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
