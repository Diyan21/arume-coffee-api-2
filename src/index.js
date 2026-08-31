import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { successResponse, errorResponse } from './utils/response.js';
import { getProducts, getProductById } from './controllers/products.js';
import { createOrder, getOrderByNumber } from './controllers/orders.js';
import {
  createPayment,
  handlePaymentCallback,
  checkPaymentStatus
} from './controllers/payment.js';

const app = new Hono();

/* =========================================================
   1. CORS
   ========================================================= */

app.use('*', cors({
  origin: (origin) => {
    // Request server-to-server / tanpa Origin
    if (!origin) return '*';

    const allowedOrigins = [
      // Production
      'https://arumeya.com',
      'https://www.arumeya.com',

      // Netlify
      'https://arumeproject2.netlify.app',
      'https://arume-coffee.netlify.app',

      // Local development
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173'
    ];

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.netlify.app') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) {
      return origin;
    }

    // Origin yang tidak diizinkan
    return null;
  },

  allowMethods: [
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'OPTIONS'
  ],

  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept'
  ],

  exposeHeaders: [
    'Content-Length'
  ],

  maxAge: 86400,
  credentials: true
}));

// Universal OPTIONS / preflight
app.options('*', (c) => c.text('', 204));


/* =========================================================
   2. HEALTH CHECK
   ========================================================= */

app.get('/api/health', (c) => {

  const isXenditConfigured = Boolean(
    c.env?.XENDIT_SECRET_KEY &&
    c.env.XENDIT_SECRET_KEY.trim().length > 0
  );

  const isSupabaseConfigured = Boolean(
    c.env?.SUPABASE_URL &&
    c.env?.SUPABASE_SERVICE_ROLE_KEY
  );

  return successResponse(
    c,
    {
      status: 'ok',
      service: 'Arume Coffee API',
      runtime: 'Cloudflare Workers',
      timestamp: new Date().toISOString(),

      xendit_configured: isXenditConfigured,
      supabase_configured: isSupabaseConfigured
    },
    'Arume Coffee API is running and healthy'
  );
});


/* =========================================================
   3. PRODUCT ROUTES
   ========================================================= */

app.get('/api/products', getProducts);

app.get(
  '/api/products/:id',
  getProductById
);


/* =========================================================
   4. ORDER ROUTES
   ========================================================= */

app.post(
  '/api/orders',
  createOrder
);

app.get(
  '/api/orders/:orderNumber',
  getOrderByNumber
);


/* =========================================================
   5. PAYMENT ROUTES
   ========================================================= */

// Membuat transaksi pembayaran
app.post(
  '/api/payment/create',
  createPayment
);

// Webhook / callback pembayaran
app.post(
  '/api/payment/callback',
  handlePaymentCallback
);

// Cek status pembayaran
app.post(
  '/api/payment/check',
  checkPaymentStatus
);


/* =========================================================
   6. ROOT / CONTROL CENTER
   ========================================================= */

app.get('/', (c) => {

  const acceptHeader =
    c.req.header('accept') || '';

  /*
   * Kalau request meminta JSON,
   * kembalikan informasi API.
   */
  if (
    acceptHeader.includes('application/json') &&
    !acceptHeader.includes('text/html')
  ) {
    return c.json({
      service: 'Arume Coffee API',
      runtime: 'Cloudflare Workers',
      framework: 'Hono',
      version: '1.0.0',
      payment_gateway: 'Xendit',
      documentation: '/api/health'
    });
  }


  /* ---------------------------------------------------------
     Environment status
     --------------------------------------------------------- */

  const isXenditConfigured = Boolean(
    c.env?.XENDIT_SECRET_KEY &&
    c.env.XENDIT_SECRET_KEY.trim().length > 0
  );

  const isSupabaseConfigured = Boolean(
    c.env?.SUPABASE_URL &&
    c.env?.SUPABASE_SERVICE_ROLE_KEY
  );

  const frontendUrl =
    c.env?.FRONTEND_URL ||
    'https://arumeya.com';


  /* ---------------------------------------------------------
     Control Center HTML
     --------------------------------------------------------- */

  const htmlContent = `
<!doctype html>

<html lang="en" class="h-full">

<head>

  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>
    Arume Coffee API — Control Center
  </title>

  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>

</head>


<body
  class="
    bg-[#141414]
    text-[#141414]
    font-sans
    antialiased
    min-h-screen
    flex
    flex-col
    p-2
    sm:p-4
  "
>

  <div
    class="
      flex
      flex-col
      min-h-[calc(100vh-2rem)]
      w-full
      max-w-7xl
      mx-auto
      bg-[#E4E3E0]
      text-[#141414]
      border-[8px]
      sm:border-[12px]
      border-[#141414]
      shadow-2xl
      overflow-hidden
    "

    style="
      font-family:
      'Helvetica Neue',
      Helvetica,
      Arial,
      sans-serif;
    "
  >


    <!-- HEADER -->

    <header
      class="
        flex
        flex-wrap
        items-center
        justify-between
        px-4
        sm:px-6
        py-4
        border-b
        border-[#141414]
        bg-[#E4E3E0]
      "
    >

      <div
        class="
          flex
          items-center
          gap-3
          sm:gap-4
          mb-2
          sm:mb-0
        "
      >

        <div
          class="
            bg-[#141414]
            text-[#E4E3E0]
            px-3
            py-1
            font-mono
            text-xs
            sm:text-sm
            font-bold
            tracking-tighter
          "
        >
          ARUME_API_V1
        </div>


        <h1
          class="
            font-serif
            italic
            text-lg
            sm:text-xl
            font-medium
          "
        >
          Control Center // Edge-Node-01
        </h1>

      </div>


      <div
        class="
          flex
          items-center
          gap-4
          sm:gap-6
          text-[10px]
          sm:text-xs
        "
      >

        <div
          class="
            flex
            items-center
            gap-2
          "
        >

          <div
            class="
              w-2.5
              h-2.5
              rounded-full
              bg-green-600
              animate-pulse
            "
          ></div>

          <span
            class="
              uppercase
              font-bold
              tracking-widest
            "
          >
            Status: Live
          </span>

        </div>

      </div>

    </header>


    <!-- MAIN -->

    <main class="p-6">

      <h2
        class="
          text-2xl
          font-bold
          mb-6
        "
      >
        API Control Center Active
      </h2>


      <div
        class="
          font-mono
          text-sm
          space-y-3
        "
      >

        <p>
          Target Worker:
          <strong>
            arume-coffee-api-2
          </strong>
        </p>


        <p>
          Payment Gateway:
          <strong>
            Xendit
          </strong>
        </p>


        <p>
          Xendit:
          <strong>
            ${
              isXenditConfigured
                ? 'Configured'
                : 'Not Configured'
            }
          </strong>
        </p>


        <p>
          Supabase:
          <strong>
            ${
              isSupabaseConfigured
                ? 'Configured'
                : 'Not Configured'
            }
          </strong>
        </p>


        <p>
          Frontend:
          <strong>
            ${frontendUrl}
          </strong>
        </p>


        <p>
          Production Domain:
          <strong>
            https://arumeya.com
          </strong>
        </p>

      </div>


      <div
        class="
          mt-8
          pt-6
          border-t
          border-[#141414]
        "
      >

        <p
          class="
            font-mono
            text-xs
            uppercase
            tracking-wider
          "
        >
          Cloudflare Workers //
          Supabase //
          Xendit
        </p>

      </div>

    </main>

  </div>

</body>

</html>
  `;


  return c.html(htmlContent);
});


/* =========================================================
   7. 404 HANDLER
   ========================================================= */

app.notFound((c) => {

  return errorResponse(
    c,
    'Endpoint not found',
    `Path '${c.req.path}' was not found on this server`,
    404
  );

});


/* =========================================================
   8. GLOBAL ERROR HANDLER
   ========================================================= */

app.onError((err, c) => {

  console.error(
    'API Error:',
    err
  );

  return errorResponse(
    c,
    'Internal Server Error',
    err.message ||
      'An unexpected error occurred',
    500
  );

});


/* =========================================================
   EXPORT
   ========================================================= */

export default app;
