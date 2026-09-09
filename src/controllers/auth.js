import {
  successResponse,
  errorResponse
} from '../utils/response.js';


/* =========================================================
   NORMALIZE EMAIL
   ========================================================= */

const normalizeEmail =
(value) => {

  return String(
    value || ''
  )
    .trim()
    .toLowerCase();
};


/* =========================================================
   NORMALIZE NAME
   ========================================================= */

const normalizeName =
(value) => {

  return String(
    value || ''
  )
    .trim()
    .slice(
      0,
      100
    );
};


/* =========================================================
   GET BEARER TOKEN
   ========================================================= */

const getBearerToken =
(request) => {

  const authorization =
    String(
      request.header(
        'Authorization'
      ) || ''
    )
      .trim();


  if (
    !authorization
      .toLowerCase()
      .startsWith(
        'bearer '
      )
  ) {

    return '';
  }


  return authorization
    .slice(
      7
    )
    .trim();
};


/* =========================================================
   BASE64 URL ENCODE
   ========================================================= */

const encodeBase64Url =
(value) => {

  const bytes =
    new TextEncoder()
      .encode(
        value
      );


  let binary =
    '';


  const chunkSize =
    0x8000;


  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {

    const chunk =
      bytes.subarray(
        i,
        Math.min(
          i + chunkSize,
          bytes.length
        )
      );


    binary +=
      String.fromCharCode(
        ...chunk
      );

  }


  return btoa(
    binary
  )
    .replace(
      /\+/g,
      '-'
    )
    .replace(
      /\//g,
      '_'
    )
    .replace(
      /=+$/g,
      ''
    );
};


/* =========================================================
   VERIFY SUPABASE USER
   ========================================================= */

const verifySupabaseUser =
async (
  c,
  token
) => {

  const supabaseUrl =
    String(
      c.env.SUPABASE_URL || ''
    )
      .replace(
        /\/+$/,
        ''
      );


  const serviceRoleKey =
    String(
      c.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );


  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {

    throw new Error(
      'Supabase backend configuration belum lengkap.'
    );
  }


  const response =
    await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {

        method:
          'GET',

        headers: {

          Authorization:
            `Bearer ${token}`,

          apikey:
            serviceRoleKey

        }

      }
    );


  if (
    !response.ok
  ) {

    console.error(
      'Supabase user verification failed:',
      response.status
    );


    return null;
  }


  return await response
    .json();
};


/* =========================================================
   GET GMAIL ACCESS TOKEN
   ========================================================= */

const getGmailAccessToken =
async (
  c
) => {

  const clientId =
    String(
      c.env.GMAIL_CLIENT_ID || ''
    );


  const clientSecret =
    String(
      c.env.GMAIL_CLIENT_SECRET || ''
    );


  const refreshToken =
    String(
      c.env.GMAIL_REFRESH_TOKEN || ''
    );


  if (
    !clientId ||
    !clientSecret ||
    !refreshToken
  ) {

    throw new Error(
      'Gmail API configuration belum lengkap.'
    );
  }


  const formData =
    new URLSearchParams();


  formData.set(
    'client_id',
    clientId
  );


  formData.set(
    'client_secret',
    clientSecret
  );


  formData.set(
    'refresh_token',
    refreshToken
  );


  formData.set(
    'grant_type',
    'refresh_token'
  );


  const response =
    await fetch(
      'https://oauth2.googleapis.com/token',
      {

        method:
          'POST',

        headers: {

          'Content-Type':
            'application/x-www-form-urlencoded'

        },

        body:
          formData.toString()

      }
    );


  const result =
    await response
      .json()
      .catch(
        () => null
      );


  if (
    !response.ok ||
    !result?.access_token
  ) {

    console.error(
      'Gmail access token error:',
      {

        status:
          response.status,

        error:
          result?.error,

        errorDescription:
          result?.error_description

      }
    );


    throw new Error(
      'Gagal mendapatkan Gmail access token.'
    );
  }


  return result.access_token;
};


/* =========================================================
   BUILD WELCOME EMAIL
   ========================================================= */

const buildWelcomeEmail =
({
  fromEmail,
  toEmail,
  name
}) => {

  const subject =
    'Pendaftaran Akun Arume Coffee Berhasil';


  const message =
`Halo ${name},

Pendaftaran akun Arume Coffee kamu telah berhasil.

Informasi akun:
Email: ${toEmail}

Simpan email dan password akun kamu dengan baik.
Jangan berikan password kepada siapa pun demi keamanan akun.

Kamu sekarang dapat masuk dan menggunakan akun Arume Coffee.

Salam,
Arume Coffee
arumeya.com`;


  const mimeMessage =
`From: Arume Coffee <${fromEmail}>
To: ${toEmail}
Subject: ${subject}
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 8bit

${message}`;


  return {

    subject:
      subject,

    raw:
      encodeBase64Url(
        mimeMessage
      )

  };
};


/* =========================================================
   SEND EMAIL VIA GMAIL API
   ========================================================= */

const sendGmail =
async (
  accessToken,
  raw
) => {

  const response =
    await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {

        method:
          'POST',

        headers: {

          Authorization:
            `Bearer ${accessToken}`,

          'Content-Type':
            'application/json'

        },

        body:
          JSON.stringify({
            raw:
              raw
          })

      }
    );


  const result =
    await response
      .json()
      .catch(
        () => null
      );


  if (
    !response.ok
  ) {

    console.error(
      'Gmail send error:',
      {

        status:
          response.status,

        error:
          result?.error?.message

      }
    );


    throw new Error(
      'Gagal mengirim email melalui Gmail API.'
    );
  }


  return result;
};


/* =========================================================
   MARK WELCOME EMAIL AS SENT
   ========================================================= */

const markWelcomeEmailSent =
async (
  c,
  user
) => {

  try {

    const supabaseUrl =
      String(
        c.env.SUPABASE_URL || ''
      )
        .replace(
          /\/+$/,
          ''
        );


    const serviceRoleKey =
      String(
        c.env.SUPABASE_SERVICE_ROLE_KEY || ''
      );


    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !user?.id
    ) {

      return;
    }


    const currentAppMetadata =
      user.app_metadata &&
      typeof user.app_metadata ===
        'object'
        ? user.app_metadata
        : {};


    const response =
      await fetch(
        `${supabaseUrl}/auth/v1/admin/users/${user.id}`,
        {

          method:
            'PUT',

          headers: {

            Authorization:
              `Bearer ${serviceRoleKey}`,

            apikey:
              serviceRoleKey,

            'Content-Type':
              'application/json'

          },

          body:
            JSON.stringify({

              app_metadata: {

                ...currentAppMetadata,

                welcome_email_sent:
                  true,

                welcome_email_sent_at:
                  new Date()
                    .toISOString()

              }

            })

        }
      );


    if (
      !response.ok
    ) {

      const result =
        await response
          .json()
          .catch(
            () => null
          );


      console.error(
        'Failed to mark welcome email as sent:',
        {

          status:
            response.status,

          error:
            result

        }
      );

    }


  } catch (
    error
  ) {

    /*
     * Email sudah berhasil dikirim.
     *
     * Kalau update metadata gagal,
     * jangan membuat request email
     * dianggap gagal.
     */

    console.error(
      'Welcome email metadata error:',
      error
    );

  }
};


/* =========================================================
   WELCOME EMAIL CONTROLLER
   ========================================================= */

export const sendWelcomeEmail =
async (
  c
) => {

  try {

    /* =====================================================
       GET AUTHORIZATION TOKEN
       ===================================================== */

    const token =
      getBearerToken(
        c.req
      );


    if (
      !token
    ) {

      return errorResponse(
        c,
        'Unauthorized.',
        401
      );
    }


    /* =====================================================
       VERIFY CUSTOMER WITH SUPABASE
       ===================================================== */

    const user =
      await verifySupabaseUser(
        c,
        token
      );


    if (
      !user?.id ||
      !user?.email
    ) {

      return errorResponse(
        c,
        'Session customer tidak valid.',
        401
      );
    }


    /* =====================================================
       CUSTOMER EMAIL

       Email WAJIB berasal dari Supabase Auth.
       Jangan menggunakan email dari request body.
       ===================================================== */

    const email =
      normalizeEmail(
        user.email
      );


    /* =====================================================
       REQUEST BODY

       Body hanya digunakan sebagai fallback nama.
       Password TIDAK PERNAH diterima di endpoint ini.
       ===================================================== */

    const body =
      await c.req
        .json()
        .catch(
          () => ({})
        );


    /* =====================================================
       CUSTOMER NAME
       ===================================================== */

    const metadataName =
      normalizeName(
        user
          ?.user_metadata
          ?.full_name
      );


    const requestName =
      normalizeName(
        body?.name
      );


    const name =
      metadataName ||
      requestName ||
      'Customer';


    /* =====================================================
       PREVENT DUPLICATE EMAIL
       ===================================================== */

    if (
      user
        ?.app_metadata
        ?.welcome_email_sent ===
          true
    ) {

      return successResponse(
        c,
        {

          sent:
            false,

          already_sent:
            true,

          email:
            email,

          message:
            'Welcome email sudah pernah dikirim.'

        }
      );

    }


    /* =====================================================
       GMAIL FROM EMAIL
       ===================================================== */

    const fromEmail =
      normalizeEmail(
        c.env.GMAIL_FROM_EMAIL
      );


    if (
      !fromEmail
    ) {

      throw new Error(
        'GMAIL_FROM_EMAIL belum dikonfigurasi.'
      );
    }


    /* =====================================================
       GET GMAIL ACCESS TOKEN
       ===================================================== */

    const gmailAccessToken =
      await getGmailAccessToken(
        c
      );


    /* =====================================================
       BUILD EMAIL
       ===================================================== */

    const emailData =
      buildWelcomeEmail({

        fromEmail:
          fromEmail,

        toEmail:
          email,

        name:
          name

      });


    /* =====================================================
       SEND EMAIL
       ===================================================== */

    const gmailResult =
      await sendGmail(
        gmailAccessToken,
        emailData.raw
      );


    /* =====================================================
       MARK EMAIL AS SENT
       ===================================================== */

    await markWelcomeEmailSent(
      c,
      user
    );


    /* =====================================================
       SAFE LOG

       Tidak pernah log:
       - password
       - access token
       - refresh token
       - client secret
       ===================================================== */

    console.log(
      'Welcome email sent:',
      {

        userId:
          user.id,

        to:
          email,

        subject:
          emailData.subject,

        gmailMessageId:
          gmailResult?.id || null

      }
    );


    /* =====================================================
       SUCCESS
       ===================================================== */

    return successResponse(
      c,
      {

        sent:
          true,

        email:
          email,

        message:
          'Welcome email berhasil dikirim.'

      }
    );


  } catch (
    error
  ) {

    console.error(
      'Welcome email error:',
      error
    );


    return errorResponse(
      c,
      'Gagal mengirim welcome email.',
      500
    );

  }

};
