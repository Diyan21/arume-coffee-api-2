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
  getOrderByNumber,
  getPublicOrderStatus,
  getAdminOrders,
  updateAdminOrderStatus,
  deleteAdminOrder
} from './controllers/orders.js';

import {
  createPayment,
  handlePaymentCallback,
  checkPaymentStatus
} from './controllers/payment.js';


const app =
  new Hono();


/* =========================================================
   ADMIN HELPERS
   ========================================================= */

const isAdminAuthorized =
(c) => {

  const configuredSecret =
    c.env?.ADMIN_SECRET ||
    '';

  const providedSecret =
    c.req.header(
      'X-ADMIN-SECRET'
    ) ||
    '';


  return Boolean(
    configuredSecret &&
    providedSecret &&
    configuredSecret ===
      providedSecret
  );
};


const getSupabaseHeaders =
(env) => ({

  apikey:
    env.SUPABASE_SERVICE_ROLE_KEY,

  Authorization:
    `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,

  'Content-Type':
    'application/json'

});


const ensureAdminEnvironment =
(c) => {

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


  if (
    !c.env?.ADMIN_SECRET
  ) {

    return errorResponse(
      c,
      'Admin configuration missing',
      'ADMIN_SECRET is not configured',
      500
    );
  }


  return null;
};


const ensureSupabaseEnvironment =
(c) => {

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


  return null;
};


/* =========================================================
   1. CORS
   ========================================================= */

app.use(
  '*',
  cors({

    origin:
      (origin) => {

        /*
         * Webhook / server-to-server
         * biasanya tidak membawa Origin.
         */

        if (
          !origin
        ) {

          return '*';
        }


        const allowedOrigins = [

          'https://arumeya.com',
          'https://www.arumeya.com',

          'https://arumeproject2.netlify.app',
          'https://arume-coffee.netlify.app',

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
          isAdminConfigured,

        shipping_api:
          true,

        order_status_api:
          true,

        admin_orders_api:
          true,

        delete_pending_order_api:
          true

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

app.get(
  '/api/admin/products',
  async (c) => {

    const environmentError =
      ensureAdminEnvironment(
        c
      );


    if (
      environmentError
    ) {

      return environmentError;
    }


    if (
      !isAdminAuthorized(
        c
      )
    ) {

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


      if (
        !response.ok
      ) {

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
            Array.isArray(
              data
            )
              ? data
              : []

        },
        'Admin products loaded successfully'
      );


    } catch (
      err
    ) {

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


/* =========================================================
   UPDATE STOCK
   ========================================================= */

app.patch(
  '/api/admin/products/:id',
  async (c) => {

    const environmentError =
      ensureAdminEnvironment(
        c
      );


    if (
      environmentError
    ) {

      return environmentError;
    }


    if (
      !isAdminAuthorized(
        c
      )
    ) {

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
        !Number.isInteger(
          stock
        ) ||
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
          `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(
            productId
          )}`,
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


      if (
        !response.ok
      ) {

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
        !Array.isArray(
          data
        ) ||
        data.length ===
          0
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


    } catch (
      err
    ) {

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
   4. SHIPPING ROUTES
   ========================================================= */

app.get(
  '/api/shipping',
  async (c) => {

    const environmentError =
      ensureSupabaseEnvironment(
        c
      );


    if (
      environmentError
    ) {

      return environmentError;
    }


    try {

      const supabaseUrl =
        c.env.SUPABASE_URL.replace(
          /\/$/,
          ''
        );


      const response =
        await fetch(
          `${supabaseUrl}/rest/v1/shipping_settings?select=id,min_distance,max_distance,fee,active&active=eq.true&order=max_distance.asc`,
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


      if (
        !response.ok
      ) {

        console.error(
          'Shipping Supabase error:',
          data
        );


        return errorResponse(
          c,
          'Failed to load shipping rates',
          data?.message ||
            'Supabase request failed',
          response.status
        );
      }


      return successResponse(
        c,
        {

          shipping_rates:
            Array.isArray(
              data
            )
              ? data
              : []

        },
        'Shipping rates loaded successfully'
      );


    } catch (
      err
    ) {

      console.error(
        'Shipping rates error:',
        err
      );


      return errorResponse(
        c,
        'Failed to load shipping rates',
        err?.message ||
          'An unexpected error occurred',
        500
      );
    }
  }
);


/* =========================================================
   ADMIN SHIPPING ROUTES
   ========================================================= */

app.get(
  '/api/admin/shipping',
  async (c) => {

    const environmentError =
      ensureAdminEnvironment(
        c
      );


    if (
      environmentError
    ) {

      return environmentError;
    }


    if (
      !isAdminAuthorized(
        c
      )
    ) {

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
          `${supabaseUrl}/rest/v1/shipping_settings?select=id,min_distance,max_distance,fee,active,created_at&order=max_distance.asc`,
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


      if (
        !response.ok
      ) {

        console.error(
          'Admin shipping Supabase error:',
          data
        );


        return errorResponse(
          c,
          'Failed to load shipping settings',
          data?.message ||
            'Supabase request failed',
          response.status
        );
      }


      return successResponse(
        c,
        {

          shipping_rates:
            Array.isArray(
              data
            )
              ? data
              : []

        },
        'Admin shipping settings loaded successfully'
      );


    } catch (
      err
    ) {

      console.error(
        'Admin shipping error:',
        err
      );


      return errorResponse(
        c,
        'Failed to load shipping settings',
        err?.message ||
          'An unexpected error occurred',
        500
      );
    }
  }
);


/* =========================================================
   UPDATE SHIPPING RATE
   ========================================================= */

app.put(
  '/api/admin/shipping/:id',
  async (c) => {

    const environmentError =
      ensureAdminEnvironment(
        c
      );


    if (
      environmentError
    ) {

      return environmentError;
    }


    if (
      !isAdminAuthorized(
        c
      )
    ) {

      return errorResponse(
        c,
        'Unauthorized',
        'Invalid admin secret',
        401
      );
    }


    try {

      const shippingId =
        c.req.param(
          'id'
        );


      const body =
        await c.req.json();


      const minDistance =
        Number(
          body?.min_distance
        );


      const maxDistance =
        Number(
          body?.max_distance
        );


      const fee =
        Number(
          body?.fee
        );


      const active =
        body?.active ===
          undefined
          ? true
          : Boolean(
              body.active
            );


      if (
        !Number.isFinite(
          minDistance
        ) ||
        minDistance < 0
      ) {

        return errorResponse(
          c,
          'Invalid minimum distance',
          'min_distance must be a number greater than or equal to 0',
          400
        );
      }


      if (
        !Number.isFinite(
          maxDistance
        ) ||
        maxDistance <= 0
      ) {

        return errorResponse(
          c,
          'Invalid maximum distance',
          'max_distance must be greater than 0',
          400
        );
      }


      if (
        maxDistance <=
        minDistance
      ) {

        return errorResponse(
          c,
          'Invalid distance range',
          'max_distance must be greater than min_distance',
          400
        );
      }


      if (
        !Number.isInteger(
          fee
        ) ||
        fee < 0
      ) {

        return errorResponse(
          c,
          'Invalid shipping fee',
          'fee must be an integer greater than or equal to 0',
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
          `${supabaseUrl}/rest/v1/shipping_settings?id=eq.${encodeURIComponent(
            shippingId
          )}`,
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

                min_distance:
                  minDistance,

                max_distance:
                  maxDistance,

                fee,

                active

              })

          }
        );


      const data =
        await response.json();


      if (
        !response.ok
      ) {

        console.error(
          'Update shipping Supabase error:',
          data
        );


        return errorResponse(
          c,
          'Failed to update shipping rate',
          data?.message ||
            'Supabase request failed',
          response.status
        );
      }


      if (
        !Array.isArray(
          data
        ) ||
        data.length ===
          0
      ) {

        return errorResponse(
          c,
          'Shipping rate not found',
          `Shipping rate '${shippingId}' was not found`,
          404
        );
      }


      return successResponse(
        c,
        {
          shipping_rate:
            data[0]
        },
        'Shipping rate updated successfully'
      );


    } catch (
      err
    ) {

      console.error(
        'Update shipping error:',
        err
      );


      return errorResponse(
        c,
        'Failed to update shipping rate',
        err?.message ||
          'An unexpected error occurred',
        500
      );
    }
  }
);


/* =========================================================
   5. ORDER ROUTES
   ========================================================= */


/* ---------------------------------------------------------
   CREATE ORDER
   --------------------------------------------------------- */

app.post(
  '/api/orders',
  createOrder
);


/* ---------------------------------------------------------
   GET FULL ORDER
   --------------------------------------------------------- */

app.get(
  '/api/orders/:orderNumber',
  getOrderByNumber
);


/* ---------------------------------------------------------
   PUBLIC CUSTOMER ORDER STATUS
   --------------------------------------------------------- */

app.get(
  '/api/order-status/:orderNumber',
  getPublicOrderStatus
);


/* =========================================================
   ADMIN ORDER ROUTES
   ========================================================= */


/* ---------------------------------------------------------
   GET ALL ADMIN ORDERS
   --------------------------------------------------------- */

app.get(
  '/api/admin/orders',
  getAdminOrders
);


/* ---------------------------------------------------------
   UPDATE ORDER STATUS
   --------------------------------------------------------- */

app.patch(
  '/api/admin/orders/:orderNumber/status',
  updateAdminOrderStatus
);


/* ---------------------------------------------------------
   DELETE PENDING / FAILED ORDER
   --------------------------------------------------------- */

/*
 * DELETE
 *
 * /api/admin/orders/:orderNumber
 *
 * Header:
 *
 * X-ADMIN-SECRET: password-admin
 *
 * Hanya pending / failed yang boleh dihapus.
 */

app.delete(
  '/api/admin/orders/:orderNumber',
  deleteAdminOrder
);


/* =========================================================
   6. PAYMENT ROUTES
   ========================================================= */

app.post(
  '/api/payment/create',
  createPayment
);


app.post(
  '/api/payment/callback',
  handlePaymentCallback
);


app.post(
  '/api/payment/check',
  checkPaymentStatus
);


/* =========================================================
   7. ROOT / CONTROL CENTER
   ========================================================= */

app.get(
  '/',
  (c) => {

    const acceptHeader =
      c.req.header(
        'accept'
      ) ||
      '';


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
          '1.5.0',

        payment_gateway:
          'Xendit',

        shipping:
          true,

        order_status:
          true,

        admin_orders:
          true,

        delete_pending_orders:
          true,

        documentation:
          '/api/health'

      });
    }


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


    const htmlContent = `
<!doctype html>

<html
  lang="en"
  class="h-full"
>

<head>

  <meta charset="UTF-8" />

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
  >


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
      "
    >

      <div>

        <div
          class="
            bg-[#141414]
            text-[#E4E3E0]
            px-3
            py-1
            inline-block
            font-mono
            text-xs
            font-bold
          "
        >
          ARUME_API_V1
        </div>

        <h1
          class="
            font-serif
            italic
            text-xl
            mt-2
          "
        >
          Control Center
        </h1>

      </div>


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
            text-xs
          "
        >
          Live
        </span>

      </div>

    </header>


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
          Worker:
          <strong>
            arume-coffee-api-2
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
          Shipping API:
          <strong>
            Enabled
          </strong>
        </p>


        <p>
          Order Status API:
          <strong>
            Enabled
          </strong>
        </p>


        <p>
          Admin Orders:
          <strong>
            Enabled
          </strong>
        </p>


        <p>
          Delete Pending Orders:
          <strong>
            Enabled
          </strong>
        </p>


        <p>
          Frontend:
          <strong>
            ${frontendUrl}
          </strong>
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
   8. 404 HANDLER
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
   9. GLOBAL ERROR HANDLER
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
