import { handleUpload } from "@vercel/blob/client";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const jsonResponse = await handleUpload({
      body: req.body,

      request: req,

      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: [
            "video/mp4",
            "video/quicktime",
            "video/webm"
          ],

          maximumSizeInBytes:
            200 * 1024 * 1024,

          addRandomSuffix: true
        };
      },

      onUploadCompleted: async ({ blob }) => {
        console.log(
          "FaceEvol video uploaded:",
          blob.pathname
        );
      }
    });

    return res.status(200).json(jsonResponse);

  } catch (error) {
    console.error("Blob upload error:", error);

    return res.status(500).json({
      error: "Could not prepare video upload"
    });
  }
}
