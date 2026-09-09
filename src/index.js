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

import {
  sendWelcomeEmail
} from './controllers/auth.js';

import {
  sendOrderPaymentSuccessWhatsApp
} from './controllers/whatsapp.js';


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
   WHATSAPP HELPERS
   ========================================================= */

const normalizeWhatsAppPhone =
(value) => {

  let phone =
    String(
      value ||
      ''
    )
      .replace(
        /[^0-9]/g,
        ''
      )
      .trim();


  /*
   * 08xxxxxxxxxx -> 628xxxxxxxxxx
   */

  if (
    phone.startsWith(
      '0'
    )
  ) {

    phone =
      `62${phone.slice(1)}`;
  }


  return phone;
};


const getWhatsAppGraphVersion =
(env) => {

  return String(
    env?.WHATSAPP_GRAPH_API_VERSION ||
    env?.WHATSAPP_GRAPH_VERSION ||
    ''
  )
    .trim();
};


const ensureWhatsAppSendEnvironment =
(c) => {

  if (
    !c.env?.WHATSAPP_ACCESS_TOKEN
  ) {

    return errorResponse(
      c,
      'WhatsApp configuration missing',
      'WHATSAPP_ACCESS_TOKEN is not configured',
      500
    );
  }


  if (
    !c.env?.WHATSAPP_PHONE_NUMBER_ID
  ) {

    return errorResponse(
      c,
      'WhatsApp configuration missing',
      'WHATSAPP_PHONE_NUMBER_ID is not configured',
      500
    );
  }


  if (
    !getWhatsAppGraphVersion(
      c.env
    )
  ) {

    return errorResponse(
      c,
      'WhatsApp configuration missing',
      'WhatsApp Graph API version is not configured',
      500
    );
  }


  return null;
};


const getIncomingMessageText =
(message) => {

  if (
    message?.type ===
    'text'
  ) {

    return message?.text?.body ||
      '';
  }


  if (
    message?.type ===
    'button'
  ) {

    return message?.button?.text ||
      '[Button]';
  }


  if (
    message?.type ===
    'interactive'
  ) {

    return (
      message?.interactive?.button_reply?.title ||
      message?.interactive?.list_reply?.title ||
      '[Interactive]'
    );
  }


  if (
    message?.type ===
    'image'
  ) {

    return '[Image]';
  }


  if (
    message?.type ===
    'video'
  ) {

    return '[Video]';
  }


  if (
    message?.type ===
    'audio'
  ) {

    return '[Audio]';
  }


  if (
    message?.type ===
    'document'
  ) {

    return '[Document]';
  }


  if (
    message?.type ===
    'sticker'
  ) {

    return '[Sticker]';
  }


  if (
    message?.type ===
    'location'
  ) {

    return '[Location]';
  }


  if (
    message?.type ===
    'contacts'
  ) {

    return '[Contact]';
  }


  return `[${message?.type || 'Message'}]`;
};


/* =========================================================
   GET WHATSAPP CONVERSATION BY PHONE
   ========================================================= */

const getWhatsAppConversationByPhone =
async (
  env,
  phoneNumber
) => {

  const supabaseUrl =
    env.SUPABASE_URL.replace(
      /\/$/,
      ''
    );


  const response =
    await fetch(
      `${supabaseUrl}/rest/v1/whatsapp_conversations?phone_number=eq.${encodeURIComponent(
        phoneNumber
      )}&select=*&limit=1`,
      {

        method:
          'GET',

        headers:
          getSupabaseHeaders(
            env
          )

      }
    );


  const data =
    await response.json();


  if (
    !response.ok
  ) {

    throw new Error(
      data?.message ||
      'Failed to load WhatsApp conversation'
    );
  }


  if (
    Array.isArray(
      data
    ) &&
    data.length >
    0
  ) {

    return data[0];
  }


  return null;
};


/* =========================================================
   CREATE WHATSAPP CONVERSATION
   ========================================================= */

const createWhatsAppConversation =
async (
  env,
  {
    phoneNumber,
    customerName = null
  }
) => {

  const supabaseUrl =
    env.SUPABASE_URL.replace(
      /\/$/,
      ''
    );


  const response =
    await fetch(
      `${supabaseUrl}/rest/v1/whatsapp_conversations`,
      {

        method:
          'POST',

        headers: {

          ...getSupabaseHeaders(
            env
          ),

          Prefer:
            'return=representation'

        },

        body:
          JSON.stringify({

            phone_number:
              phoneNumber,

            customer_name:
              customerName,

            last_message:
              null,

            last_message_at:
              null,

            unread_count:
              0

          })

      }
    );


  const data =
    await response.json();


  if (
    !response.ok
  ) {

    throw new Error(
      data?.message ||
      'Failed to create WhatsApp conversation'
    );
  }


  return Array.isArray(
    data
  )
    ? data[0]
    : null;
};


/* =========================================================
   GET OR CREATE CONVERSATION
   ========================================================= */

const getOrCreateWhatsAppConversation =
async (
  env,
  {
    phoneNumber,
    customerName = null
  }
) => {

  const existing =
    await getWhatsAppConversationByPhone(
      env,
      phoneNumber
    );


  if (
    existing
  ) {

    return existing;
  }


  return createWhatsAppConversation(
    env,
    {
      phoneNumber,
      customerName
    }
  );
};


/* =========================================================
   SAVE WHATSAPP MESSAGE
   ========================================================= */

const saveWhatsAppMessage =
async (
  env,
  message
) => {

  const supabaseUrl =
    env.SUPABASE_URL.replace(
      /\/$/,
      ''
    );


  const response =
    await fetch(
      `${supabaseUrl}/rest/v1/whatsapp_messages?on_conflict=whatsapp_message_id`,
      {

        method:
          'POST',

        headers: {

          ...getSupabaseHeaders(
            env
          ),

          Prefer:
            'resolution=ignore-duplicates,return=representation'

        },

        body:
          JSON.stringify(
            message
          )

      }
    );


  const data =
    await response.json();


  if (
    !response.ok
  ) {

    throw new Error(
      data?.message ||
      'Failed to save WhatsApp message'
    );
  }


  if (
    Array.isArray(
      data
    )
  ) {

    return data[0] ||
      null;
  }


  return null;
};


/* =========================================================
   UPDATE INCOMING CONVERSATION
   ========================================================= */

const updateConversationIncoming =
async (
  env,
  {
    conversation,
    customerName,
    messageText,
    messageTime
  }
) => {

  const supabaseUrl =
    env.SUPABASE_URL.replace(
      /\/$/,
      ''
    );


  const response =
    await fetch(
      `${supabaseUrl}/rest/v1/whatsapp_conversations?id=eq.${encodeURIComponent(
        conversation.id
      )}`,
      {

        method:
          'PATCH',

        headers: {

          ...getSupabaseHeaders(
            env
          ),

          Prefer:
            'return=representation'

        },

        body:
          JSON.stringify({

            customer_name:
              customerName ||
              conversation.customer_name ||
              null,

            last_message:
              messageText,

            last_message_at:
              messageTime,

            unread_count:
              Number(
                conversation.unread_count ||
                0
              ) +
              1

          })

      }
    );


  const data =
    await response.json();


  if (
    !response.ok
  ) {

    throw new Error(
      data?.message ||
      'Failed to update conversation'
    );
  }


  return Array.isArray(
    data
  )
    ? data[0]
    : null;
};


/* =========================================================
   UPDATE OUTGOING CONVERSATION
   ========================================================= */

const updateConversationOutgoing =
async (
  env,
  {
    conversation,
    messageText,
    messageTime
  }
) => {

  const supabaseUrl =
    env.SUPABASE_URL.replace(
      /\/$/,
      ''
    );


  const response =
    await fetch(
      `${supabaseUrl}/rest/v1/whatsapp_conversations?id=eq.${encodeURIComponent(
        conversation.id
      )}`,
      {

        method:
          'PATCH',

        headers: {

          ...getSupabaseHeaders(
            env
          ),

          Prefer:
            'return=representation'

        },

        body:
          JSON.stringify({

            last_message:
              messageText,

            last_message_at:
              messageTime

          })

      }
    );


  const data =
    await response.json();


  if (
    !response.ok
  ) {

    throw new Error(
      data?.message ||
      'Failed to update conversation'
    );
  }


  return Array.isArray(
    data
  )
    ? data[0]
    : null;
};


/* =========================================================
   UPDATE MESSAGE STATUS
   ========================================================= */

const updateWhatsAppMessageStatus =
async (
  env,
  {
    whatsappMessageId,
    status
  }
) => {

  if (
    !whatsappMessageId
  ) {

    return;
  }


  const allowedStatus = [
    'received',
    'sent',
    'delivered',
    'read',
    'failed'
  ];


  if (
    !allowedStatus.includes(
      status
    )
  ) {

    return;
  }


  const supabaseUrl =
    env.SUPABASE_URL.replace(
      /\/$/,
      ''
    );


  const response =
    await fetch(
      `${supabaseUrl}/rest/v1/whatsapp_messages?whatsapp_message_id=eq.${encodeURIComponent(
        whatsappMessageId
      )}`,
      {

        method:
          'PATCH',

        headers: {

          ...getSupabaseHeaders(
            env
          ),

          Prefer:
            'return=minimal'

        },

        body:
          JSON.stringify({
            status
          })

      }
    );


  if (
    !response.ok
  ) {

    const data =
      await response.text();


    console.error(
      'Update WhatsApp status error:',
      data
    );
  }
};


/* =========================================================
   CORS
   ========================================================= */

app.use(
  '*',
  cors({

    origin:
      (origin) => {

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
   OPTIONS
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
   HEALTH CHECK
   ========================================================= */

app.get(
  '/api/health',
  (c) => {

    const isXenditConfigured =
      Boolean(
        c.env?.XENDIT_SECRET_KEY
      );


    const isXenditWebhookConfigured =
      Boolean(
        c.env?.XENDIT_WEBHOOK_TOKEN
      );


    const isSupabaseConfigured =
      Boolean(
        c.env?.SUPABASE_URL &&
        c.env?.SUPABASE_SERVICE_ROLE_KEY
      );


    const isAdminConfigured =
      Boolean(
        c.env?.ADMIN_SECRET
      );


    const isWhatsAppConfigured =
      Boolean(
        c.env?.WHATSAPP_ACCESS_TOKEN &&
        c.env?.WHATSAPP_PHONE_NUMBER_ID &&
        c.env?.WHATSAPP_VERIFY_TOKEN &&
        getWhatsAppGraphVersion(
          c.env
        )
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

        whatsapp_configured:
          isWhatsAppConfigured,

        shipping_api:
          true,

        order_status_api:
          true,

        admin_orders_api:
          true,

        whatsapp_api:
          true

      },

      'Arume Coffee API is running and healthy'
    );
  }
);


/* =========================================================
   PRODUCT ROUTES
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
   ADMIN PRODUCTS
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

      return errorResponse(
        c,
        'Failed to load products',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   UPDATE PRODUCT STOCK
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
        stock <
        0
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

      return errorResponse(
        c,
        'Failed to update stock',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   PUBLIC SHIPPING
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

      return errorResponse(
        c,
        'Failed to load shipping rates',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   ADMIN SHIPPING
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
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   UPDATE SHIPPING
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
        minDistance <
        0
      ) {

        return errorResponse(
          c,
          'Invalid minimum distance',
          'min_distance must be greater than or equal to 0',
          400
        );
      }


      if (
        !Number.isFinite(
          maxDistance
        ) ||
        maxDistance <=
        0
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
        fee <
        0
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

      return errorResponse(
        c,
        'Failed to update shipping rate',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   ORDER ROUTES
   ========================================================= */

app.post(
  '/api/orders',
  createOrder
);


app.get(
  '/api/orders/:orderNumber',
  getOrderByNumber
);


app.get(
  '/api/order-status/:orderNumber',
  getPublicOrderStatus
);


/* =========================================================
   ADMIN ORDER ROUTES
   ========================================================= */

app.get(
  '/api/admin/orders',
  getAdminOrders
);


app.patch(
  '/api/admin/orders/:orderNumber/status',
  updateAdminOrderStatus
);


app.delete(
  '/api/admin/orders/:orderNumber',
  deleteAdminOrder
);


/* =========================================================
   WHATSAPP WEBHOOK VERIFY
   ========================================================= */

app.get(
  '/api/whatsapp/webhook',
  (c) => {

    const mode =
      c.req.query(
        'hub.mode'
      );


    const token =
      c.req.query(
        'hub.verify_token'
      );


    const challenge =
      c.req.query(
        'hub.challenge'
      );


    const configuredToken =
      c.env?.WHATSAPP_VERIFY_TOKEN ||
      '';


    if (
      mode ===
      'subscribe' &&
      configuredToken &&
      token ===
      configuredToken
    ) {

      return c.text(
        challenge ||
        '',
        200
      );
    }


    console.warn(
      'WhatsApp webhook verification failed'
    );


    return c.text(
      'Forbidden',
      403
    );
  }
);


/* =========================================================
   WHATSAPP WEBHOOK INCOMING
   ========================================================= */

app.post(
  '/api/whatsapp/webhook',
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

      const payload =
        await c.req.json();


      const entries =
        Array.isArray(
          payload?.entry
        )
          ? payload.entry
          : [];


      for (
        const entry
        of entries
      ) {

        const changes =
          Array.isArray(
            entry?.changes
          )
            ? entry.changes
            : [];


        for (
          const change
          of changes
        ) {

          const value =
            change?.value ||
            {};


          /* =================================================
             MESSAGE STATUS
             ================================================= */

          const statuses =
            Array.isArray(
              value?.statuses
            )
              ? value.statuses
              : [];


          for (
            const item
            of statuses
          ) {

            const messageId =
              item?.id ||
              '';


            const status =
              item?.status ||
              '';


            await updateWhatsAppMessageStatus(
              c.env,
              {

                whatsappMessageId:
                  messageId,

                status

              }
            );
          }


          /* =================================================
             INCOMING MESSAGES
             ================================================= */

          const messages =
            Array.isArray(
              value?.messages
            )
              ? value.messages
              : [];


          const contacts =
            Array.isArray(
              value?.contacts
            )
              ? value.contacts
              : [];


          for (
            const message
            of messages
          ) {

            const phoneNumber =
              normalizeWhatsAppPhone(
                message?.from
              );


            if (
              !phoneNumber
            ) {

              continue;
            }


            const contact =
              contacts.find(
                (item) =>
                  normalizeWhatsAppPhone(
                    item?.wa_id
                  ) ===
                  phoneNumber
              );


            const customerName =
              contact?.profile?.name ||
              null;


            const messageText =
              getIncomingMessageText(
                message
              );


            const timestampNumber =
              Number(
                message?.timestamp
              );


            const messageTime =
              Number.isFinite(
                timestampNumber
              )
                ? new Date(
                    timestampNumber *
                    1000
                  )
                    .toISOString()
                : new Date()
                    .toISOString();


            let conversation =
              await getOrCreateWhatsAppConversation(
                c.env,
                {

                  phoneNumber,

                  customerName

                }
              );


            const savedMessage =
              await saveWhatsAppMessage(
                c.env,
                {

                  conversation_id:
                    conversation.id,

                  whatsapp_message_id:
                    message?.id ||
                    null,

                  phone_number:
                    phoneNumber,

                  direction:
                    'incoming',

                  message_type:
                    message?.type ||
                    'text',

                  message_text:
                    messageText,

                  status:
                    'received',

                  created_at:
                    messageTime

                }
              );


            if (
              savedMessage
            ) {

              conversation =
                await updateConversationIncoming(
                  c.env,
                  {

                    conversation,

                    customerName,

                    messageText,

                    messageTime

                  }
                );
            }
          }
        }
      }


      return c.json(
        {
          received:
            true
        },
        200
      );


    } catch (
      err
    ) {

      console.error(
        'WhatsApp webhook error:',
        err
      );


      return errorResponse(
        c,
        'WhatsApp webhook failed',
        err?.message ||
        'Unexpected webhook error',
        500
      );
    }
  }
);


/* =========================================================
   ADMIN WHATSAPP - CONVERSATIONS
   ========================================================= */

app.get(
  '/api/admin/whatsapp/conversations',
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
          `${supabaseUrl}/rest/v1/whatsapp_conversations?select=*&order=last_message_at.desc.nullslast`,
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

        return errorResponse(
          c,
          'Failed to load WhatsApp conversations',
          data?.message ||
          'Supabase request failed',
          response.status
        );
      }


      return successResponse(
        c,
        {

          conversations:
            Array.isArray(
              data
            )
              ? data
              : []

        },

        'WhatsApp conversations loaded successfully'
      );


    } catch (
      err
    ) {

      console.error(
        'WhatsApp conversations error:',
        err
      );


      return errorResponse(
        c,
        'Failed to load WhatsApp conversations',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   ADMIN WHATSAPP - MESSAGES
   ========================================================= */

app.get(
  '/api/admin/whatsapp/conversations/:phone/messages',
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

      const phoneNumber =
        normalizeWhatsAppPhone(
          c.req.param(
            'phone'
          )
        );


      if (
        !phoneNumber
      ) {

        return errorResponse(
          c,
          'Invalid phone number',
          'Phone number is required',
          400
        );
      }


      const conversation =
        await getWhatsAppConversationByPhone(
          c.env,
          phoneNumber
        );


      if (
        !conversation
      ) {

        return successResponse(
          c,
          {

            conversation:
              null,

            messages:
              []

          },

          'No WhatsApp conversation found'
        );
      }


      const supabaseUrl =
        c.env.SUPABASE_URL.replace(
          /\/$/,
          ''
        );


      const response =
        await fetch(
          `${supabaseUrl}/rest/v1/whatsapp_messages?conversation_id=eq.${encodeURIComponent(
            conversation.id
          )}&select=*&order=created_at.asc`,
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

        return errorResponse(
          c,
          'Failed to load WhatsApp messages',
          data?.message ||
          'Supabase request failed',
          response.status
        );
      }


      return successResponse(
        c,
        {

          conversation,

          messages:
            Array.isArray(
              data
            )
              ? data
              : []

        },

        'WhatsApp messages loaded successfully'
      );


    } catch (
      err
    ) {

      console.error(
        'WhatsApp messages error:',
        err
      );


      return errorResponse(
        c,
        'Failed to load WhatsApp messages',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   ADMIN WHATSAPP - MARK READ
   ========================================================= */

app.patch(
  '/api/admin/whatsapp/conversations/:phone/read',
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

      const phoneNumber =
        normalizeWhatsAppPhone(
          c.req.param(
            'phone'
          )
        );


      if (
        !phoneNumber
      ) {

        return errorResponse(
          c,
          'Invalid phone number',
          'Phone number is required',
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
          `${supabaseUrl}/rest/v1/whatsapp_conversations?phone_number=eq.${encodeURIComponent(
            phoneNumber
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

                unread_count:
                  0

              })

          }
        );


      const data =
        await response.json();


      if (
        !response.ok
      ) {

        return errorResponse(
          c,
          'Failed to mark conversation as read',
          data?.message ||
          'Supabase request failed',
          response.status
        );
      }


      return successResponse(
        c,
        {

          conversation:
            Array.isArray(
              data
            )
              ? data[0] ||
                null
              : null

        },

        'Conversation marked as read'
      );


    } catch (
      err
    ) {

      return errorResponse(
        c,
        'Failed to mark conversation as read',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   ADMIN WHATSAPP - SEND MESSAGE
   ========================================================= */

app.post(
  '/api/admin/whatsapp/send',
  async (c) => {

    const adminError =
      ensureAdminEnvironment(
        c
      );


    if (
      adminError
    ) {

      return adminError;
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


    const whatsappError =
      ensureWhatsAppSendEnvironment(
        c
      );


    if (
      whatsappError
    ) {

      return whatsappError;
    }


    try {

      const body =
        await c.req.json();


      const phoneNumber =
        normalizeWhatsAppPhone(
          body?.phone_number ||
          body?.phone
        );


      const messageText =
        String(
          body?.message_text ||
          body?.message ||
          ''
        )
          .trim();


      if (
        !phoneNumber
      ) {

        return errorResponse(
          c,
          'Phone number required',
          'phone_number is required',
          400
        );
      }


      if (
        !messageText
      ) {

        return errorResponse(
          c,
          'Message required',
          'message_text is required',
          400
        );
      }


      if (
        messageText.length >
        4096
      ) {

        return errorResponse(
          c,
          'Message too long',
          'message_text must be 4096 characters or fewer',
          400
        );
      }


      const graphVersion =
        getWhatsAppGraphVersion(
          c.env
        );


      const graphUrl =
        `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(
          c.env.WHATSAPP_PHONE_NUMBER_ID
        )}/messages`;


      const graphResponse =
        await fetch(
          graphUrl,
          {

            method:
              'POST',

            headers: {

              Authorization:
                `Bearer ${c.env.WHATSAPP_ACCESS_TOKEN}`,

              'Content-Type':
                'application/json'

            },

            body:
              JSON.stringify({

                messaging_product:
                  'whatsapp',

                recipient_type:
                  'individual',

                to:
                  phoneNumber,

                type:
                  'text',

                text: {

                  preview_url:
                    false,

                  body:
                    messageText

                }

              })

          }
        );


      const graphData =
        await graphResponse.json();


      if (
        !graphResponse.ok
      ) {

        console.error(
          'WhatsApp Graph API error:',
          graphData
        );


        return errorResponse(
          c,
          'Failed to send WhatsApp message',
          graphData?.error?.message ||
          'Meta Graph API request failed',
          graphResponse.status
        );
      }


      const whatsappMessageId =
        graphData?.messages?.[0]?.id ||
        null;


      const messageTime =
        new Date()
          .toISOString();


      let conversation =
        await getOrCreateWhatsAppConversation(
          c.env,
          {

            phoneNumber,

            customerName:
              null

          }
        );


      const savedMessage =
        await saveWhatsAppMessage(
          c.env,
          {

            conversation_id:
              conversation.id,

            whatsapp_message_id:
              whatsappMessageId,

            phone_number:
              phoneNumber,

            direction:
              'outgoing',

            message_type:
              'text',

            message_text:
              messageText,

            status:
              'sent',

            created_at:
              messageTime

          }
        );


      conversation =
        await updateConversationOutgoing(
          c.env,
          {

            conversation,

            messageText,

            messageTime

          }
        );


      return successResponse(
        c,
        {

          message: {

            id:
              savedMessage?.id ||
              null,

            whatsapp_message_id:
              whatsappMessageId,

            phone_number:
              phoneNumber,

            direction:
              'outgoing',

            message_type:
              'text',

            message_text:
              messageText,

            status:
              'sent',

            created_at:
              messageTime

          },

          conversation

        },

        'WhatsApp message sent successfully'
      );


    } catch (
      err
    ) {

      console.error(
        'WhatsApp send error:',
        err
      );


      return errorResponse(
        c,
        'Failed to send WhatsApp message',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   ADMIN WHATSAPP - TEST PAYMENT SUCCESS TEMPLATE
   ========================================================= */

app.post(
  '/api/admin/whatsapp/test-payment-success',
  async (c) => {

    const adminError =
      ensureAdminEnvironment(
        c
      );


    if (
      adminError
    ) {

      return adminError;
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


    const whatsappError =
      ensureWhatsAppSendEnvironment(
        c
      );


    if (
      whatsappError
    ) {

      return whatsappError;
    }


    try {

      const body =
        await c.req
          .json()
          .catch(
            () => ({})
          );


      const phoneNumber =
        normalizeWhatsAppPhone(
          body?.phone_number ||
          body?.phone
        );


      if (
        !phoneNumber
      ) {

        return errorResponse(
          c,
          'Phone number required',
          'phone_number is required',
          400
        );
      }


      const customerName =
        String(
          body?.customer_name ||
          'Diyan'
        )
          .trim();


      const orderNumber =
        String(
          body?.order_number ||
          'ARC-TEST-001'
        )
          .trim();


      const total =
        Number(
          body?.total ??
          45000
        );


      if (
        !Number.isFinite(
          total
        ) ||
        total <
        0
      ) {

        return errorResponse(
          c,
          'Invalid total',
          'total must be a valid number',
          400
        );
      }


      const result =
        await sendOrderPaymentSuccessWhatsApp(
          c.env,
          {

            phoneNumber,

            customerName,

            orderNumber,

            total

          }
        );


      if (
        !result?.success
      ) {

        return errorResponse(
          c,
          'WhatsApp template failed',
          result?.error ||
          result?.reason ||
          'Failed to send WhatsApp template',
          result?.status ||
          500
        );
      }


      return successResponse(
        c,
        result,
        'WhatsApp payment template sent successfully'
      );


    } catch (
      err
    ) {

      console.error(
        'WhatsApp test template error:',
        err
      );


      return errorResponse(
        c,
        'WhatsApp template test failed',
        err?.message ||
        'Unexpected error',
        500
      );
    }
  }
);


/* =========================================================
   AUTH
   ========================================================= */

app.post(
  '/api/auth/welcome-email',
  sendWelcomeEmail
);


/* =========================================================
   PAYMENT ROUTES
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
   ROOT / CONTROL CENTER
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
          '2.0.0',

        payment_gateway:
          'Xendit',

        shipping:
          true,

        order_status:
          true,

        admin_orders:
          true,

        whatsapp:
          true,

        whatsapp_webhook:
          '/api/whatsapp/webhook',

        whatsapp_template_test:
          '/api/admin/whatsapp/test-payment-success',

        documentation:
          '/api/health'

      });
    }


    const frontendUrl =
      c.env?.FRONTEND_URL ||
      'https://arumeya.com';


    const whatsappConfigured =
      Boolean(
        c.env?.WHATSAPP_ACCESS_TOKEN &&
        c.env?.WHATSAPP_PHONE_NUMBER_ID &&
        c.env?.WHATSAPP_VERIFY_TOKEN &&
        getWhatsAppGraphVersion(
          c.env
        )
      );


    const htmlContent = `
<!doctype html>

<html lang="en">

<head>

  <meta charset="UTF-8" />

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>
    Arume Coffee API
  </title>

  <style>

    body {
      margin: 0;
      padding: 40px 20px;
      background: #0a0806;
      color: #f3ece2;
      font-family: Arial, sans-serif;
    }

    .container {
      max-width: 760px;
      margin: auto;
    }

    .card {
      border: 1px solid #5c4a34;
      border-radius: 18px;
      padding: 24px;
      background: #15110d;
    }

    h1 {
      color: #d7ad62;
    }

    .status {
      color: #86efac;
    }

    code {
      color: #e7c98f;
    }

  </style>

</head>

<body>

  <div class="container">

    <div class="card">

      <h1>
        Arume Coffee API
      </h1>

      <p class="status">
        ● API Online
      </p>

      <p>
        Runtime:
        Cloudflare Workers + Hono
      </p>

      <p>
        WhatsApp:
        ${
          whatsappConfigured
            ? 'Configured'
            : 'Not Configured'
        }
      </p>

      <p>
        Webhook:
        <code>
          /api/whatsapp/webhook
        </code>
      </p>

      <p>
        Template Test:
        <code>
          /api/admin/whatsapp/test-payment-success
        </code>
      </p>

      <p>
        Frontend:
        ${frontendUrl}
      </p>

    </div>

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
   404
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
   GLOBAL ERROR HANDLER
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
