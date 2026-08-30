import {
  del
} from "@vercel/blob";

import { createHmac, timingSafeEqual } from "node:crypto";

export const config = { api: { bodyParser: false } };


const FACEVOL_SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "https://hasffllflyeoitsenlgc.supabase.co";

const FACEVOL_SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_r4T07DT0rPGl1v6avJ-Qiw_exZZn30r";

const FACEVOL_SUPABASE_SECRET_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const FACEVOL_STRIPE_PACKS = Object.freeze({
  "20": { credits:20, amount:499, currency:"eur", priceId:process.env.STRIPE_PRICE_20 || "price_1U9mH80rPkHkBzyys6sICOfU" },
  "60": { credits:60, amount:1199, currency:"eur", priceId:process.env.STRIPE_PRICE_60 || "price_1U9mHo0rPkHkBzyylbGQ3n2U" },
  "150": { credits:150, amount:2499, currency:"eur", priceId:process.env.STRIPE_PRICE_150 || "price_1U9mIJ0rPkHkBzyytYo2U6BM" }
});


function faceEvolBearerToken(req) {
  const header = String(
    req.headers?.authorization ||
    req.headers?.Authorization ||
    ""
  ).trim();

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}


async function faceEvolReadResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}


async function faceEvolUserRequest(
  accessToken,
  pathname,
  options = {}
) {
  const response = await fetch(
    `${FACEVOL_SUPABASE_URL}${pathname}`,
    {
      ...options,
      headers: {
        apikey: FACEVOL_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const data = await faceEvolReadResponse(response);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" &&
        (data.message || data.error_description || data.error || data.details)) ||
      (typeof data === "string" ? data : "") ||
      `Supabase HTTP ${response.status}`;

    const error = new Error(String(message));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}


function faceEvolAdminHeaders(extra = {}) {
  if (!FACEVOL_SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is not configured");
  }

  const headers = {
    apikey: FACEVOL_SUPABASE_SECRET_KEY,
    "Content-Type": "application/json",
    ...extra
  };

  if (
    !FACEVOL_SUPABASE_SECRET_KEY.startsWith("sb_secret_") &&
    FACEVOL_SUPABASE_SECRET_KEY.split(".").length === 3
  ) {
    headers.Authorization = `Bearer ${FACEVOL_SUPABASE_SECRET_KEY}`;
  }

  return headers;
}


async function faceEvolAdminRequest(
  pathname,
  options = {}
) {
  const response = await fetch(
    `${FACEVOL_SUPABASE_URL}${pathname}`,
    {
      ...options,
      headers: faceEvolAdminHeaders(options.headers || {})
    }
  );

  const data = await faceEvolReadResponse(response);

  if (!response.ok) {
    const message =
      (data && typeof data === "object" &&
        (data.message || data.error_description || data.error || data.details)) ||
      (typeof data === "string" ? data : "") ||
      `Supabase admin HTTP ${response.status}`;

    const error = new Error(String(message));
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}


async function faceEvolAdminRpc(functionName, payload) {
  return faceEvolAdminRequest(
    `/rest/v1/rpc/${encodeURIComponent(functionName)}`,
    {
      method: "POST",
      body: JSON.stringify(payload || {})
    }
  );
}


async function faceEvolRequireUser(req, res) {
  if (!FACEVOL_SUPABASE_SECRET_KEY) {
    res.status(500).json({
      error: "FaceEvol server security is not configured.",
      code: "SERVER_SECURITY_NOT_CONFIGURED"
    });
    return null;
  }

  const accessToken = faceEvolBearerToken(req);

  if (!accessToken) {
    res.status(401).json({
      error: "Sign in is required to check FaceEvol AI results.",
      code: "AUTH_REQUIRED"
    });
    return null;
  }

  try {
    const user = await faceEvolUserRequest(
      accessToken,
      "/auth/v1/user",
      { method: "GET" }
    );

    if (!user || !user.id) {
      res.status(401).json({
        error: "Your FaceEvol session is no longer valid. Please sign in again.",
        code: "AUTH_REQUIRED"
      });
      return null;
    }

    return { accessToken, user };
  } catch (error) {
    console.warn(
      "FaceEvol prediction authentication rejected:",
      error instanceof Error ? error.message : String(error)
    );

    res.status(401).json({
      error: "Your FaceEvol session is no longer valid. Please sign in again.",
      code: "AUTH_REQUIRED"
    });
    return null;
  }
}


async function faceEvolOwnedGeneration(
  userId,
  predictionId
) {
  const user = encodeURIComponent(userId);
  const prediction = encodeURIComponent(predictionId);

  const data = await faceEvolAdminRequest(
    `/rest/v1/generation_jobs?select=request_reference,tool,credits,status,prediction_id,provider_status&user_id=eq.${user}&prediction_id=eq.${prediction}&limit=1`,
    { method: "GET" }
  );

  return Array.isArray(data) && data.length
    ? data[0]
    : null;
}


async function faceEvolFinalizePrediction(
  userId,
  predictionId,
  providerStatus
) {
  return faceEvolAdminRpc(
    "finalize_faceevol_prediction_admin",
    {
      p_user_id: userId,
      p_prediction_id: predictionId,
      p_provider_status: providerStatus
    }
  );
}


function extractTemporaryPathname(
  inputUrlString,
  expectedRoute,
  expectedPrefix
) {
  try {
    if (
      typeof inputUrlString !==
        "string" ||
      !inputUrlString.startsWith(
        "https://"
      )
    ) {
      return null;
    }


    const url =
      new URL(
        inputUrlString
      );


    /*
     * Existing FaceEvol proxy URL:
     * https://www.faceevol.com/api/video.mp4?pathname=...
     */
    if (
      url.hostname ===
        "www.faceevol.com" &&
      url.pathname ===
        expectedRoute
    ) {
      const pathname =
        url.searchParams.get(
          "pathname"
        );


      if (
        pathname &&
        pathname.startsWith(
          expectedPrefix
        )
      ) {
        return pathname;
      }
    }


    /*
     * Video Enhance signed Vercel Blob URL.
     * Recover only a FaceEvol temporary pathname so cleanup
     * cannot delete an arbitrary external object.
     */
    if (
      url.hostname.endsWith(
        ".private.blob.vercel-storage.com"
      )
    ) {
      const pathname =
        decodeURIComponent(
          url.pathname.replace(
            /^\/+/, ""
          )
        );


      if (
        pathname &&
        pathname.startsWith(
          expectedPrefix
        ) &&
        !pathname.includes(
          ".."
        )
      ) {
        return pathname;
      }
    }


    return null;

  } catch {
    return null;
  }
}


async function cleanupPredictionInputs(
  prediction
) {
  /* Collect every temporary FaceEvol input, including arrays used by mapped multi-person video. */
  const rawCandidates = [
    prediction?.input?.source,
    prediction?.input?.target,
    prediction?.input?.source_image,
    prediction?.input?.target_video,
    prediction?.input?.video,
    prediction?.input?.images
  ];

  const candidateInputs = rawCandidates.flatMap(value => Array.isArray(value) ? value : [value]);
  const pathnames = [];

  for (const value of candidateInputs) {
    const facePathname = extractTemporaryPathname(value, "/api/image.jpg", "faceevol-face-");
    const videoPathname = extractTemporaryPathname(value, "/api/video.mp4", "faceevol-video-");
    if (facePathname) pathnames.push(facePathname);
    if (videoPathname) pathnames.push(videoPathname);
  }

  const safePathnames = [...new Set(pathnames.filter(Boolean))];
  if (!safePathnames.length) {
    console.warn("No temporary FaceEvol inputs found for cleanup.");
    return;
  }

  try {
    await del(safePathnames);
    console.log("Deleted temporary FaceEvol inputs:", safePathnames);
  } catch (error) {
    console.warn("Temporary Blob cleanup failed:", error instanceof Error ? error.message : String(error));
  }
}


async function faceEvolReadRawBody(req,maxBytes=1000000){
  const chunks=[]; let total=0;
  for await (const chunk of req){
    const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
    total+=b.length; if(total>maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function faceEvolSafeJson(raw){
  try{return JSON.parse(raw.toString("utf8"));}catch{return null;}
}

function faceEvolEnforceStripeTester(user){
  if(!STRIPE_SECRET_KEY.startsWith("sk_test_")) return;
  const email=String(process.env.STRIPE_TEST_EMAIL||"").trim().toLowerCase();
  const uid=String(process.env.STRIPE_TEST_USER_ID||"").trim();
  if(!email&&!uid){ const e=new Error("STRIPE_TEST_ACCESS_NOT_CONFIGURED"); e.status=503; throw e; }
  const ok=(email&&String(user?.email||"").trim().toLowerCase()===email)||(uid&&String(user?.id||"")===uid);
  if(!ok){ const e=new Error("STRIPE_TEST_ACCESS_DENIED"); e.status=403; throw e; }
}

async function faceEvolStripeRequest(pathname,form){
  const response=await fetch(`https://api.stripe.com${pathname}`,{
    method:"POST",
    headers:{Authorization:`Bearer ${STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded"},
    body:form.toString()
  });
  const text=await response.text(); let data=null;
  try{data=text?JSON.parse(text):null;}catch{data={error:{message:text.slice(0,1000)}};}
  if(!response.ok){ const e=new Error(data?.error?.message||`Stripe HTTP ${response.status}`); e.status=response.status; throw e; }
  return data;
}

function faceEvolVerifyStripeWebhook(raw,header){
  if(!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  let t=null; const sigs=[];
  for(const part of String(header||"").split(",")){
    const i=part.indexOf("="); if(i<1) continue;
    const k=part.slice(0,i).trim(), v=part.slice(i+1).trim();
    if(k==="t") t=v; if(k==="v1") sigs.push(v);
  }
  const ts=Number(t); if(!Number.isFinite(ts)||!sigs.length) throw new Error("Invalid Stripe signature header");
  if(Math.abs(Math.floor(Date.now()/1000)-ts)>300) throw new Error("Stripe webhook timestamp is outside tolerance");
  const expected=createHmac("sha256",STRIPE_WEBHOOK_SECRET).update(`${ts}.${raw.toString("utf8")}`,"utf8").digest("hex");
  const expectedBuf=Buffer.from(expected,"hex");
  const ok=sigs.some(sig=>{
    if(!/^[0-9a-f]+$/i.test(sig)) return false;
    const actual=Buffer.from(sig,"hex");
    return actual.length===expectedBuf.length&&timingSafeEqual(actual,expectedBuf);
  });
  if(!ok) throw new Error("Invalid Stripe webhook signature");
}

async function handleStripeCheckout(req,res,raw){
  if(!STRIPE_SECRET_KEY) return res.status(500).json({error:"Stripe is not configured.",code:"STRIPE_NOT_CONFIGURED"});
  const auth=await faceEvolRequireUser(req,res); if(!auth) return;
  faceEvolEnforceStripeTester(auth.user);
  const body=faceEvolSafeJson(raw)||{};
  if(body.action!=="checkout") return res.status(400).json({error:"Invalid Stripe action."});
  const key=String(body.pack||""); const pack=FACEVOL_STRIPE_PACKS[key];
  if(!pack) return res.status(400).json({error:"Invalid FaceEvol credit pack."});
  const origin="https://www.faceevol.com";
  const form=new URLSearchParams();
  form.set("mode","payment");
  form.set("success_url",`${origin}/?payment=success&session_id={CHECKOUT_SESSION_ID}#pricing`);
  form.set("cancel_url",`${origin}/?payment=cancelled#pricing`);
  form.set("line_items[0][price]",pack.priceId);
  form.set("line_items[0][quantity]","1");
  form.set("client_reference_id",auth.user.id);
  if(auth.user.email) form.set("customer_email",auth.user.email);
  form.set("metadata[purpose]","faceevol_credits");
  form.set("metadata[user_id]",auth.user.id);
  form.set("metadata[credits]",String(pack.credits));
  form.set("metadata[pack]",key);
  form.set("metadata[price_id]",pack.priceId);
  const session=await faceEvolStripeRequest("/v1/checkout/sessions",form);
  if(!session?.id||!session?.url) throw new Error("Stripe returned an invalid Checkout Session.");
  return res.status(200).json({success:true,checkout_session_id:session.id,url:session.url});
}

async function faceEvolApplyStripeCredits(session){
  const m=session?.metadata||{};
  if(m.purpose!=="faceevol_credits") return {ignored:true};
  const userId=String(m.user_id||session?.client_reference_id||"").trim();
  const credits=Number(m.credits); const key=String(m.pack||credits||""); const pack=FACEVOL_STRIPE_PACKS[key];
  const amount=Number(session?.amount_total); const currency=String(session?.currency||"").toLowerCase();
  if(!userId||!Number.isInteger(credits)||!pack||pack.credits!==credits||m.price_id!==pack.priceId||amount!==pack.amount||currency!==pack.currency){
    throw new Error("Invalid FaceEvol Stripe purchase metadata");
  }
  return faceEvolAdminRpc("apply_faceevol_stripe_purchase_admin",{
    p_user_id:userId,
    p_credits:credits,
    p_stripe_session_id:String(session.id),
    p_stripe_payment_intent:session?.payment_intent?String(session.payment_intent):null,
    p_amount_total:amount,
    p_currency:currency
  });
}

async function handleStripeWebhook(req,res,raw){
  try{faceEvolVerifyStripeWebhook(raw,req.headers?.["stripe-signature"]);}catch(error){
    console.error("FaceEvol Stripe webhook verification failed:",error instanceof Error?error.message:String(error));
    return res.status(400).json({error:"Invalid webhook signature."});
  }
  const event=faceEvolSafeJson(raw); if(!event) return res.status(400).json({error:"Invalid webhook payload."});
  if(event.type==="checkout.session.completed"||event.type==="checkout.session.async_payment_succeeded"){
    const session=event?.data?.object;
    if(session?.mode==="payment"&&session?.payment_status==="paid"){
      try{await faceEvolApplyStripeCredits(session);}catch(error){
        console.error("FaceEvol Stripe credit delivery failed:",error);
        return res.status(500).json({error:"Credit delivery failed."});
      }
    }
  }
  return res.status(200).json({received:true});
}



async function handlePredictionGet(
  req,
  res
) {
  const faceEvolAuth =
    await faceEvolRequireUser(
      req,
      res
    );

  if (!faceEvolAuth) {
    return;
  }


  const replicateToken = process.env.REPLICATE_API_TOKEN;

  const { id } = req.query || {};


  if (
    typeof id !== "string" ||
    !/^[a-zA-Z0-9]+$/.test(
      id
    )
  ) {
    return res.status(400).json({
      error:
        "A valid prediction ID is required"
    });
  }


  let ownedGeneration;

  try {
    ownedGeneration =
      await faceEvolOwnedGeneration(
        faceEvolAuth.user.id,
        id
      );
  } catch (error) {
    console.error(
      "FaceEvol generation ownership check failed:",
      error
    );

    return res.status(503).json({
      error:
        "FaceEvol couldn't verify this generation right now. Please try again.",
      code:
        "GENERATION_ACCESS_CHECK_FAILED"
    });
  }

  if (!ownedGeneration) {
    return res.status(403).json({
      error:
        "This AI generation does not belong to your FaceEvol account.",
      code:
        "GENERATION_ACCESS_DENIED"
    });
  }


  try {
    if (!replicateToken) {
      return res.status(500).json({ error: "REPLICATE_API_TOKEN is not configured" });
    }
    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${id}`,
      { method: "GET", headers: { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" } }
    );
    let prediction;
    try { prediction = await response.json(); } catch { prediction = null; }
    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to retrieve prediction", details: prediction });
    }
    if (!prediction) {
      return res.status(502).json({ error: "Replicate returned an invalid prediction response" });
    }


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


    const finished =
      prediction.status ===
        "succeeded" ||
      prediction.status ===
        "failed" ||
      prediction.status ===
        "canceled";


    /*
     * Replicate is finished with
     * the source files, so remove
     * the temporary private Blobs.
     */
    if (finished) {
      await cleanupPredictionInputs(
        prediction
      );
    }


    let faceEvolCredit = null;

    try {
      faceEvolCredit =
        await faceEvolFinalizePrediction(
          faceEvolAuth.user.id,
          String(prediction.id || id),
          String(prediction.status || "")
        );
    } catch (creditError) {
      /*
       * Never hide a valid AI result just because the credit ledger
       * could not be updated. Log it so it can be reconciled safely.
       */
      console.error(
        "FaceEvol prediction credit finalization failed:",
        creditError
      );
    }


    res.setHeader(
      "Cache-Control",
      "no-store"
    );


    return res
      .status(200)
      .json({
        id:
          prediction.id,

        status:
          prediction.status,

        output:
          prediction.output ??
          null,

        error:
          prediction.error ??
          null,

        faceevol_credit:
          faceEvolCredit &&
          typeof faceEvolCredit === "object"
            ? {
                ...faceEvolCredit,
                reserved:
                  faceEvolCredit.refunded !== true
              }
            : null
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


export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");

  if(req.method==="GET"){
    return handlePredictionGet(req,res);
  }

  if(req.method==="POST"){
    let raw;
    try{raw=await faceEvolReadRawBody(req);}catch{return res.status(413).json({error:"Request body is too large."});}

    if(req.headers?.["stripe-signature"]){
      return handleStripeWebhook(req,res,raw);
    }

    try{
      return await handleStripeCheckout(req,res,raw);
    }catch(error){
      const code=String(error instanceof Error?error.message:error);
      if(code==="STRIPE_TEST_ACCESS_NOT_CONFIGURED") return res.status(503).json({error:"Stripe Sandbox is protected. Add STRIPE_TEST_EMAIL or STRIPE_TEST_USER_ID in Vercel before testing.",code});
      if(code==="STRIPE_TEST_ACCESS_DENIED") return res.status(403).json({error:"Stripe checkout is currently in private Sandbox testing.",code});
      console.error("FaceEvol Stripe checkout error:",error);
      return res.status(Number(error?.status)||500).json({error:error instanceof Error?error.message:"Could not start Stripe Checkout.",code:"STRIPE_CHECKOUT_FAILED"});
    }
  }

  res.setHeader("Allow","GET, POST");
  return res.status(405).json({error:"Method not allowed"});
}

