import { Hono } from 'hono';
import { cors } from 'hono/cors';

import {
  successResponse,
  errorResponse
} from './utils/response.js';

import {
  getProducts,
  getProductById
} from './controllers/products.js';

import {
  createOrder,
  getOrderByNumber
} from './controllers/orders.js';

import {
  createPayment,
  handlePaymentCallback,
  checkPaymentStatus
} from './controllers/payment.js';


const app = new Hono();


/* =========================================================
   ADMIN HELPERS
   ========================================================= */

const isAdminAuthorized = (c) => {
  const configuredSecret =
    c.env?.ADMIN_SECRET || '';

  const providedSecret =
    c.req.header('X-ADMIN-SECRET') || '';

  return Boolean(
    configuredSecret &&
    providedSecret &&
    configuredSecret === providedSecret
  );
};


const getSupabaseHeaders = (env) => ({
  apikey:
    env.SUPABASE_SERVICE_ROLE_KEY,

  Authorization:
    `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

  'Content-Type':
    'application/json'
});


const ensureAdminEnvironment = (c) => {
  if (
    !c.env?.SUPABASE_URL ||
    !c.env?.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return errorResponse(
      c,
      'Supabase configuration missing',
      'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured',
      500
    );
  }

  if (!c.env?.ADMIN_SECRET) {
    return errorResponse(
      c,
      'Admin configuration missing',
      'ADMIN_SECRET is not configured',
      500
    );
  }

  return null;
};


/* =========================================================
   1. CORS
   ========================================================= */

app.use(
  '*',
  cors({
    origin: (origin) => {

      /*
       * Server-to-server request seperti webhook Xendit
       * biasanya tidak membawa Origin.
       */
      if (!origin) {
        return '*';
      }


      const allowedOrigins = [
        /*
         * Production
         */
        'https://arumeya.com',
        'https://www.arumeya.com',

        /*
         * Netlify fallback / preview
         */
        'https://arumeproject2.netlify.app',
        'https://arume-coffee.netlify.app',

        /*
         * Local development
         */
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173'
      ];


      if (
        allowedOrigins.includes(
          origin
        ) ||

        origin.endsWith(
          '.netlify.app'
        ) ||

        origin.includes(
          'localhost'
        ) ||

        origin.includes(
          '127.0.0.1'
        )
      ) {
        return origin;
      }


      return null;
    },


    allowMethods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS'
    ],


    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'X-CALLBACK-TOKEN',
      'X-ADMIN-SECRET'
    ],


    exposeHeaders: [
      'Content-Length'
    ],


    maxAge:
      86400,


    credentials:
      true
  })
);


/* =========================================================
   UNIVERSAL OPTIONS
   ========================================================= */

app.options(
  '*',
  (c) => {

    return c.text(
      '',
      204
    );
  }
);


/* =========================================================
   2. HEALTH CHECK
   ========================================================= */

app.get(
  '/api/health',
  (c) => {

    const isXenditConfigured =
      Boolean(
        c.env?.XENDIT_SECRET_KEY &&
        c.env.XENDIT_SECRET_KEY
          .trim()
          .length > 0
      );


    const isXenditWebhookConfigured =
      Boolean(
        c.env?.XENDIT_WEBHOOK_TOKEN &&
        c.env.XENDIT_WEBHOOK_TOKEN
          .trim()
          .length > 0
      );


    const isSupabaseConfigured =
      Boolean(
        c.env?.SUPABASE_URL &&
        c.env?.SUPABASE_SERVICE_ROLE_KEY
      );


    const isAdminConfigured =
      Boolean(
        c.env?.ADMIN_SECRET &&
        c.env.ADMIN_SECRET
          .trim()
          .length > 0
      );


    return successResponse(
      c,
      {
        status:
          'ok',

        service:
          'Arume Coffee API',

        runtime:
          'Cloudflare Workers',

        timestamp:
          new Date()
            .toISOString(),

        payment_gateway:
          'Xendit',

        xendit_configured:
          isXenditConfigured,

        xendit_webhook_configured:
          isXenditWebhookConfigured,

        supabase_configured:
          isSupabaseConfigured,

        admin_configured:
          isAdminConfigured
      },
      'Arume Coffee API is running and healthy'
    );
  }
);


/* =========================================================
   3. PRODUCT ROUTES
   ========================================================= */

app.get(
  '/api/products',
  getProducts
);


app.get(
  '/api/products/:id',
  getProductById
);


/* =========================================================
   ADMIN PRODUCT / STOCK ROUTES
   ========================================================= */

/*
 * GET ADMIN PRODUCTS
 *
 * Header:
 *
 * X-ADMIN-SECRET: password-admin
 */

app.get(
  '/api/admin/products',
  async (c) => {

    const environmentError =
      ensureAdminEnvironment(c);

    if (environmentError) {
      return environmentError;
    }


    if (!isAdminAuthorized(c)) {
      return errorResponse(
        c,
        'Unauthorized',
        'Invalid admin secret',
        401
      );
    }


    try {

      const supabaseUrl =
        c.env.SUPABASE_URL.replace(
          /\/$/,
          ''
        );


      const response =
        await fetch(
          `${supabaseUrl}/rest/v1/products?select=id,name,price,stock,image_url,category&order=name.asc`,
          {
            method:
              'GET',

            headers:
              getSupabaseHeaders(
                c.env
              )
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        console.error(
          'Admin products Supabase error:',
          data
        );


        return errorResponse(
          c,
          'Failed to load products',
          data?.message ||
            'Supabase request failed',
          response.status
        );
      }


      return successResponse(
        c,
        {
          products:
            Array.isArray(data)
              ? data
              : []
        },
        'Admin products loaded successfully'
      );

    } catch (err) {

      console.error(
        'Admin products error:',
        err
      );


      return errorResponse(
        c,
        'Failed to load products',
        err?.message ||
          'An unexpected error occurred',
        500
      );
    }
  }
);


/*
 * UPDATE STOCK
 *
 * PATCH /api/admin/products/:id
 *
 * Header:
 *
 * X-ADMIN-SECRET: password-admin
 *
 * Body:
 *
 * {
 *   "stock": 10
 * }
 */

app.patch(
  '/api/admin/products/:id',
  async (c) => {

    const environmentError =
      ensureAdminEnvironment(c);

    if (environmentError) {
      return environmentError;
    }


    if (!isAdminAuthorized(c)) {
      return errorResponse(
        c,
        'Unauthorized',
        'Invalid admin secret',
        401
      );
    }


    try {

      const productId =
        c.req.param(
          'id'
        );


      const body =
        await c.req.json();


      const stock =
        Number(
          body?.stock
        );


      if (
        !Number.isInteger(stock) ||
        stock < 0
      ) {
        return errorResponse(
          c,
          'Invalid stock',
          'Stock must be an integer greater than or equal to 0',
          400
        );
      }


      const supabaseUrl =
        c.env.SUPABASE_URL.replace(
          /\/$/,
          ''
        );


      const response =
        await fetch(
          `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}`,
          {
            method:
              'PATCH',

            headers: {
              ...getSupabaseHeaders(
                c.env
              ),

              Prefer:
                'return=representation'
            },

            body:
              JSON.stringify({
                stock
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        console.error(
          'Update stock Supabase error:',
          data
        );


        return errorResponse(
          c,
          'Failed to update stock',
          data?.message ||
            'Supabase request failed',
          response.status
        );
      }


      if (
        !Array.isArray(data) ||
        data.length === 0
      ) {
        return errorResponse(
          c,
          'Product not found',
          `Product '${productId}' was not found`,
          404
        );
      }


      return successResponse(
        c,
        {
          product:
            data[0]
        },
        'Stock updated successfully'
      );

    } catch (err) {

      console.error(
        'Update stock error:',
        err
      );


      return errorResponse(
        c,
        'Failed to update stock',
        err?.message ||
          'An unexpected error occurred',
        500
      );
    }
  }
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

/*
 * Membuat Xendit Payment Session
 */

app.post(
  '/api/payment/create',
  createPayment
);


/*
 * Webhook Xendit.
 *
 * Payment Session Completed
 * Payment Session Expired
 *
 * Keduanya diarahkan ke endpoint ini.
 */

app.post(
  '/api/payment/callback',
  handlePaymentCallback
);


/*
 * Cek status payment/order
 */

app.post(
  '/api/payment/check',
  checkPaymentStatus
);


/* =========================================================
   6. ROOT / CONTROL CENTER
   ========================================================= */

app.get(
  '/',
  (c) => {

    const acceptHeader =
      c.req.header(
        'accept'
      ) || '';


    /*
     * Kalau request meminta JSON,
     * return informasi API.
     */

    if (
      acceptHeader.includes(
        'application/json'
      ) &&

      !acceptHeader.includes(
        'text/html'
      )
    ) {

      return c.json({
        service:
          'Arume Coffee API',

        runtime:
          'Cloudflare Workers',

        framework:
          'Hono',

        version:
          '1.2.0',

        payment_gateway:
          'Xendit',

        documentation:
          '/api/health'
      });
    }


    /* -----------------------------------------------------
       ENVIRONMENT STATUS
       ----------------------------------------------------- */

    const isXenditConfigured =
      Boolean(
        c.env?.XENDIT_SECRET_KEY &&
        c.env.XENDIT_SECRET_KEY
          .trim()
          .length > 0
      );


    const isXenditWebhookConfigured =
      Boolean(
        c.env?.XENDIT_WEBHOOK_TOKEN &&
        c.env.XENDIT_WEBHOOK_TOKEN
          .trim()
          .length > 0
      );


    const isSupabaseConfigured =
      Boolean(
        c.env?.SUPABASE_URL &&
        c.env?.SUPABASE_SERVICE_ROLE_KEY
      );


    const isAdminConfigured =
      Boolean(
        c.env?.ADMIN_SECRET &&
        c.env.ADMIN_SECRET
          .trim()
          .length > 0
      );


    const frontendUrl =
      c.env?.FRONTEND_URL ||
      'https://arumeya.com';


    /* -----------------------------------------------------
       CONTROL CENTER HTML
       ----------------------------------------------------- */

    const htmlContent = `
<!doctype html>

<html
  lang="en"
  class="h-full"
>

<head>

  <meta
    charset="UTF-8"
  />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>
    Arume Coffee API — Control Center
  </title>

  <script
    src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"
  ></script>

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

    <main
      class="p-6"
    >

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
          Xendit API:
          <strong>
            ${
              isXenditConfigured
                ? 'Configured'
                : 'Not Configured'
            }
          </strong>
        </p>


        <p>
          Xendit Webhook:
          <strong>
            ${
              isXenditWebhookConfigured
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
          Admin API:
          <strong>
            ${
              isAdminConfigured
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
          Xendit //
          Admin Stock API
        </p>

      </div>

    </main>

  </div>

</body>

</html>
    `;


    return c.html(
      htmlContent
    );
  }
);


/* =========================================================
   7. 404 HANDLER
   ========================================================= */

app.notFound(
  (c) => {

    return errorResponse(
      c,
      'Endpoint not found',
      `Path '${c.req.path}' was not found on this server`,
      404
    );
  }
);


/* =========================================================
   8. GLOBAL ERROR HANDLER
   ========================================================= */

app.onError(
  (err, c) => {

    console.error(
      'API Error:',
      err
    );


    return errorResponse(
      c,
      'Internal Server Error',
      err?.message ||
        'An unexpected error occurred',
      500
    );
  }
);


/* =========================================================
   EXPORT
   ========================================================= */

export default app;
