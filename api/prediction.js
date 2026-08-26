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

    const prediction =
      await response.json();

    if (!response.ok) {
      console.error(
        "Replicate prediction lookup failed:",
        prediction
      );

      return res
        .status(response.status)
        .json({
          error:
            "Failed to retrieve prediction",

          details:
            prediction
        });
    }

    /*
      Diagnostic logging.

      This lets us see exactly what Replicate
      returned when it says the job succeeded.
    */
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

    if (
      prediction.status === "succeeded" &&
      (
        !prediction.output ||
        (
          Array.isArray(prediction.output) &&
          prediction.output.length === 0
        )
      )
    ) {
      console.error(
        "FACEVOL WARNING: Replicate reported succeeded but returned empty output."
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
        prediction.output ?? null,

      error:
        prediction.error ?? null
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
