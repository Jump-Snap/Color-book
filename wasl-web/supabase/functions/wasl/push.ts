let cached: { token: string; until: number } | null = null;
const enc = new TextEncoder();
function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
async function access(sa: any) {
  if (cached && cached.until > Date.now()) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const payload =
    b64(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))) +
    "." +
    b64(
      enc.encode(
        JSON.stringify({
          iss: sa.client_email,
          scope: "https://www.googleapis.com/auth/firebase.messaging",
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        }),
      ),
    );
  const der = Uint8Array.from(
    atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const jwt =
    payload +
    "." +
    b64(
      new Uint8Array(
        await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(payload)),
      ),
    );
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const t = await r.json();
  if (!r.ok || !t.access_token) throw Error("FCM authorization failed");
  cached = { token: t.access_token, until: Date.now() + 3000000 };
  return t.access_token;
}
export async function sendPush(
  db: any,
  getSecret: (name: string) => Promise<string>,
) {
  const raw = await getSecret("firebase");
  if (!raw) return { sent: 0, configured: false };
  const jobs = await db.rpc("claim_push_jobs");
  if (jobs.error) throw Error("Push queue unavailable");
  if (!jobs.data.length) return { sent: 0, configured: true };
  const sa = JSON.parse(raw),
    token = await access(sa);
  let sent = 0;
  for (const j of jobs.data) {
    try {
      const r = await fetch(
        "https://fcm.googleapis.com/v1/projects/" +
          sa.project_id +
          "/messages:send",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: j.fcm_token,
              data: {
                id: String(j.notification_id),
                title: j.title,
                body: j.body,
              },
              android: { priority: "HIGH", ttl: "86400s" },
            },
          }),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (r.ok) {
        await db
          .from("push_deliveries")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", j.id);
        sent++;
      } else {
        const body = await r.json();
        const invalid = body.error?.details?.some(
          (d: any) => d.errorCode === "UNREGISTERED",
        );
        await db
          .from("push_deliveries")
          .update({
            status: invalid ? "invalid" : "pending",
            error: "FCM " + r.status,
            next_attempt: new Date(Date.now() + 300000).toISOString(),
          })
          .eq("id", j.id);
        if (invalid)
          await db
            .from("devices")
            .update({ fcm_token: null })
            .eq("id", j.device_id)
            .eq("fcm_token", j.fcm_token);
      }
    } catch {
      await db
        .from("push_deliveries")
        .update({
          status: "pending",
          error: "تعذر الاتصال بخدمة الإشعارات",
          next_attempt: new Date(Date.now() + 300000).toISOString(),
        })
        .eq("id", j.id);
    }
  }
  return { sent, configured: true };
}
