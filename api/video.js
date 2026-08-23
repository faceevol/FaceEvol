import { get } from "@vercel/blob";
import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

function createSignature(pathname, expires, secret) {
  return createHmac("sha256", secret)
    .update(`${pathname}:${expires}`)
    .digest("hex");
}

function signaturesMatch(received, expected) {
  if (
    !received ||
    received.length !== expected.length
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(received),
    Buffer.from(expected)
  );
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed"
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  try {
    const secret =
      process.env.REPLICATE_API_TOKEN;

    if (!secret) {
      return new Response(
        "Server configuration error",
        { status: 500 }
      );
    }

    const url = new URL(request.url);

    const pathname =
      url.searchParams.get("pathname");

    const expires =
      url.searchParams.get("expires");

    const signature =
      url.searchParams.get("signature");

    if (!pathname || !expires || !signature) {
      return new Response(
        "Missing authorization",
        { status: 400 }
      );
    }

    const expiresNumber = Number(expires);

    if (
      !Number.isFinite(expiresNumber) ||
      Date.now() > expiresNumber
    ) {
      return new Response(
        "Link expired",
        { status: 403 }
      );
    }

    const expectedSignature =
      createSignature(
        pathname,
        expires,
        secret
      );

    if (
      !signaturesMatch(
        signature,
        expectedSignature
      )
    ) {
      return new Response(
        "Unauthorized",
        { status: 403 }
      );
    }

    const result = await get(
      pathname,
      {
        access: "private"
      }
    );

    if (
      !result ||
      result.statusCode !== 200 ||
      !result.stream
    ) {
      return new Response(
        "Video not found",
        { status: 404 }
      );
    }

    const headers = new Headers();

    headers.set(
      "Content-Type",
      result.blob.contentType ||
        "video/mp4"
    );

    headers.set(
      "Cache-Control",
      "private, no-store"
    );

    headers.set(
      "X-Content-Type-Options",
      "nosniff"
    );

    if (result.blob.size) {
      headers.set(
        "Content-Length",
        String(result.blob.size)
      );
    }

    return new Response(
      result.stream,
      {
        status: 200,
        headers
      }
    );

  } catch (error) {
    console.error(
      "Private video stream error:",
      error
    );

    return new Response(
      "Video unavailable",
      { status: 500 }
    );
  }
}
