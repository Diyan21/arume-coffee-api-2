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
   VALIDATE EMAIL
   ========================================================= */

const isValidEmail =
(email) => {

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    .test(
      email
    );
};


/* =========================================================
   WELCOME EMAIL
   ========================================================= */

export const sendWelcomeEmail =
async (
  c
) => {

  try {

    /* =====================================================
       BODY
       ===================================================== */

    const body =
      await c.req.json()
        .catch(
          () => null
        );


    if (
      !body
    ) {

      return errorResponse(
        c,
        'Invalid request body.',
        400
      );
    }


    /* =====================================================
       CUSTOMER DATA
       ===================================================== */

    const name =
      normalizeName(
        body.name
      );


    const email =
      normalizeEmail(
        body.email
      );


    /* =====================================================
       VALIDATION
       ===================================================== */

    if (
      !name
    ) {

      return errorResponse(
        c,
        'Nama customer wajib diisi.',
        400
      );
    }


    if (
      !email
    ) {

      return errorResponse(
        c,
        'Email customer wajib diisi.',
        400
      );
    }


    if (
      !isValidEmail(
        email
      )
    ) {

      return errorResponse(
        c,
        'Format email tidak valid.',
        400
      );
    }


    /* =====================================================
       IMPORTANT

       Password customer TIDAK diterima endpoint ini.
       Jangan pernah tambahkan password ke request ini.
       ===================================================== */


    /* =====================================================
       TEMPORARY EMAIL DATA

       Gmail API akan kita pasang di bagian ini nanti.
       ===================================================== */

    const emailData = {

      to:
        email,

      name:
        name,

      subject:
        'Selamat Datang di Arume Coffee',

      message:
        `Halo ${name},

Terima kasih telah mendaftar di Arume Coffee.

Email akun kamu:
${email}

Simpan password akun kamu dengan aman dan jangan memberikannya kepada siapa pun.

Selamat menikmati layanan Arume Coffee.

Salam,
Arume Coffee
arumeya.com`

    };


    /* =====================================================
       DEVELOPMENT LOG

       Jangan log password / credential.
       ===================================================== */

    console.log(
      'Welcome email prepared:',
      {
        to:
          emailData.to,

        subject:
          emailData.subject
      }
    );


    /* =====================================================
       SUCCESS

       Untuk sekarang endpoint hanya menyiapkan email.
       Gmail API kita sambungkan berikutnya.
       ===================================================== */

    return successResponse(
      c,
      {
        prepared:
          true,

        email:
          email,

        message:
          'Welcome email prepared successfully.'
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
      'Gagal memproses welcome email.',
      500
    );

  }
};
