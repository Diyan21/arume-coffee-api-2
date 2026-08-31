const XENDIT_API_BASE =
  'https://api.xendit.co';


/* =========================================================
   BASIC AUTH
   ========================================================= */

const getXenditAuthHeader = (
  secretKey
) => {

  const encoded =
    btoa(
      `${secretKey}:`
    );

  return `Basic ${encoded}`;
};


/* =========================================================
   VERIFY CONFIG
   ========================================================= */

export const isXenditConfigured =
(env) => {

  return Boolean(
    env?.XENDIT_SECRET_KEY
  );
};


/* =========================================================
   SANITIZE
   ========================================================= */

const sanitizeReferenceId =
(value) => {

  return String(value || '')
    .replace(
      /[^a-zA-Z0-9_-]/g,
      ''
    )
    .slice(
      0,
      64
    );
};


const sanitizeCustomerName =
(value) => {

  const result =
    String(value || 'Customer')
      .replace(
        /[^a-zA-Z0-9 ]/g,
        ''
      )
      .trim();

  return (
    result ||
    'Customer'
  ).slice(
    0,
    50
  );
};


/* =========================================================
   CREATE XENDIT PAYMENT SESSION
   ========================================================= */

export const createXenditPaymentSession =
async (
  env,
  {
    orderNumber,
    grossAmount,
    customer
  }
) => {

  if (
    !env?.XENDIT_SECRET_KEY
  ) {
    throw new Error(
      'XENDIT_SECRET_KEY is not configured'
    );
  }


  if (!orderNumber) {
    throw new Error(
      'Order number is required'
    );
  }


  const amount =
    Number(
      grossAmount
    );


  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new Error(
      'Invalid payment amount'
    );
  }


  /*
   * Reference ID kita buat sama
   * dengan order_number.
   *
   * Ini penting supaya webhook
   * gampang dicocokkan kembali
   * ke order di Supabase.
   */
  const referenceId =
    sanitizeReferenceId(
      orderNumber
    );


  const payload = {
  reference_id: safeReferenceId,
  session_type: 'PAY',
  mode: 'PAYMENT_LINK',

  amount: Number(grossAmount),

  currency: 'IDR',
  country: 'ID',

  capture_method: 'AUTOMATIC_CAPTURE',

  success_return_url:
    `https://arumeya.com/?payment=success&order=${encodeURIComponent(orderNumber)}`,

  cancel_return_url:
    `https://arumeya.com/?payment=cancelled&order=${encodeURIComponent(orderNumber)}`,

  ...(customer
    ? {
        customer: {
          reference_id: `customer-${safeReferenceId}`,
          type: 'INDIVIDUAL',
          email: customer.email,
          individual_detail: {
            given_names: customer.name || 'Customer',
          },
        },
      }
    : {}),
};


  /*
   * Customer opsional.
   * Hanya kirim kalau punya email.
   */
  if (
    customer?.email
  ) {

    payload.customer = {
      reference_id:
        sanitizeReferenceId(
          `CUST_${orderNumber}`
        ),

      type:
        'INDIVIDUAL',

      email:
        String(
          customer.email
        ).trim(),

      individual_detail: {
        given_names:
          sanitizeCustomerName(
            customer.name
          )
      }
    };


    if (
      customer?.phone
    ) {

      payload.customer.mobile_number =
        String(
          customer.phone
        ).trim();
    }
  }


  console.log(
    'Create Xendit Payment Session:',
    JSON.stringify({
      ...payload,
      customer:
        payload.customer
          ? {
              ...payload.customer,
              email:
                '[REDACTED]',
              mobile_number:
                payload.customer
                  .mobile_number
                  ? '[REDACTED]'
                  : undefined
            }
          : undefined
    })
  );


  const response =
    await fetch(
      `${XENDIT_API_BASE}/sessions`,
      {
        method:
          'POST',

        headers: {
          Authorization:
            getXenditAuthHeader(
              env.XENDIT_SECRET_KEY
            ),

          'Content-Type':
            'application/json'
        },

        body:
          JSON.stringify(
            payload
          )
      }
    );


  const responseText =
    await response.text();


  let result =
    null;


  try {

    result =
      responseText
        ? JSON.parse(
            responseText
          )
        : {};

  } catch {

    result = {
      raw:
        responseText
    };
  }


  if (!response.ok) {

    console.error(
      'Xendit create session failed:',
      result
    );


    throw new Error(
      result?.message ||
      result?.error_code ||
      `Xendit API returned HTTP ${response.status}`
    );
  }


  const sessionId =
    result.payment_session_id ||
    result.id ||
    null;


  const redirectUrl =
    result.payment_link_url ||
    result.payment_link ||
    null;


  if (!sessionId) {

    console.error(
      'Xendit session missing payment_session_id:',
      result
    );


    throw new Error(
      'Xendit response does not contain payment_session_id'
    );
  }


  if (!redirectUrl) {

    console.error(
      'Xendit session missing payment_link_url:',
      result
    );


    throw new Error(
      'Xendit response does not contain payment_link_url'
    );
  }


  return {
    provider:
      'xendit',

    session_id:
      sessionId,

    redirect_url:
      redirectUrl,

    payment_link_url:
      redirectUrl,

    reference_id:
      result.reference_id ||
      referenceId,

    status:
      result.status ||
      null,

    raw:
      result
  };
};


/* =========================================================
   GET PAYMENT SESSION
   ========================================================= */

export const getXenditPaymentSession =
async (
  env,
  sessionId
) => {

  if (
    !env?.XENDIT_SECRET_KEY
  ) {
    throw new Error(
      'XENDIT_SECRET_KEY is not configured'
    );
  }


  if (!sessionId) {
    throw new Error(
      'Payment session ID is required'
    );
  }


  const response =
    await fetch(
      `${XENDIT_API_BASE}/sessions/${encodeURIComponent(sessionId)}`,
      {
        method:
          'GET',

        headers: {
          Authorization:
            getXenditAuthHeader(
              env.XENDIT_SECRET_KEY
            ),

          Accept:
            'application/json'
        }
      }
    );


  const responseText =
    await response.text();


  let result =
    null;


  try {

    result =
      responseText
        ? JSON.parse(
            responseText
          )
        : {};

  } catch {

    result = {
      raw:
        responseText
    };
  }


  if (!response.ok) {

    console.error(
      'Xendit get session failed:',
      result
    );


    throw new Error(
      result?.message ||
      result?.error_code ||
      `Xendit API returned HTTP ${response.status}`
    );
  }


  return result;
};


/* =========================================================
   VERIFY XENDIT WEBHOOK
   ========================================================= */

export const verifyXenditWebhook =
(
  env,
  callbackToken
) => {

  const expectedToken =
    env?.XENDIT_WEBHOOK_TOKEN;


  if (
    !expectedToken ||
    !callbackToken
  ) {
    return false;
  }


  /*
   * Untuk Cloudflare Worker kita
   * cukup cocokkan token yang
   * dikirim Xendit dengan secret
   * yang tersimpan di environment.
   */
  return (
    String(callbackToken) ===
    String(expectedToken)
  );
};
