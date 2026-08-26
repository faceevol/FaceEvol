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

        // Only allow files created by the FaceEvol
        // video-upload flow.
        if (
          typeof pathname !== "string" ||
          !pathname.startsWith("faceevol-")
        ) {
          throw new Error(
            "Invalid FaceEvol upload pathname"
          );
        }

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
          "FaceEvol temporary video uploaded:",
          blob.pathname
        );
      }
    });

    return res
      .status(200)
      .json(jsonResponse);

  } catch (error) {
    console.error(
      "Blob upload error:",
      error
    );

    return res.status(500).json({
      error:
        "Could not prepare video upload"
    });
  }
}
