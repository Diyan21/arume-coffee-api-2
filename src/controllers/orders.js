import {
  getSupabaseClient
} from '../config/supabase.js';

import {
  getProductsByIds
} from './products.js';

import {
  successResponse,
  errorResponse
} from '../utils/response.js';


/* =========================================================
   MEMORY FALLBACK
   ========================================================= */

const inMemoryOrdersMap =
  new Map();


/* =========================================================
   STORE LOCATION
   ========================================================= */

/*
 * Titik asal pengiriman Arume Coffee.
 *
 * MIN 7 Jakarta Barat
 * Cengkareng Timur
 */

const STORE_LOCATION = {
  name:
    'Arume Coffee',

  latitude:
    -6.145680,

  longitude:
    106.736081
};


/* =========================================================
   PRODUCT ID ALIASES
   ========================================================= */

const PRODUCT_ID_ALIASES = {
  'arumeya-aren-latte':
    'prod-01',

  'arumeya-butterscotch':
    'prod-02',

  'arumeya-hazelnut-latte':
    'prod-03',

  'arumeya-banana-latte':
    'prod-04',

  'arumeya-americano':
    'prod-05'
};


/* =========================================================
   NORMALIZE PRODUCT ID
   ========================================================= */

const normalizeProductId =
(id) => {

  const rawId =
    String(
      id || ''
    );


  return (
    PRODUCT_ID_ALIASES[
      rawId
    ] ||
    rawId
  );
};


/* =========================================================
   NUMBER HELPERS
   ========================================================= */

const toFiniteNumber =
(value) => {

  const number =
    Number(
      value
    );


  return Number.isFinite(
    number
  )
    ? number
    : null;
};


/* =========================================================
   HAVERSINE DISTANCE
   ========================================================= */

/*
 * Menghitung jarak garis lurus
 * antara toko dan customer.
 *
 * Return dalam kilometer.
 */

const calculateDistanceKm =
(
  lat1,
  lon1,
  lat2,
  lon2
) => {

  const earthRadiusKm =
    6371;


  const toRadians =
    (degree) =>
      degree *
      (
        Math.PI /
        180
      );


  const latitudeDifference =
    toRadians(
      lat2 -
      lat1
    );


  const longitudeDifference =
    toRadians(
      lon2 -
      lon1
    );


  const a =
    Math.sin(
      latitudeDifference /
      2
    ) ** 2 +

    Math.cos(
      toRadians(
        lat1
      )
    ) *

    Math.cos(
      toRadians(
        lat2
      )
    ) *

    Math.sin(
      longitudeDifference /
      2
    ) ** 2;


  const c =
    2 *
    Math.atan2(
      Math.sqrt(
        a
      ),

      Math.sqrt(
        1 -
        a
      )
    );


  return (
    earthRadiusKm *
    c
  );
};


/* =========================================================
   ROUND DISTANCE
   ========================================================= */

const roundDistance =
(distance) => {

  return Math.round(
    Number(
      distance
    ) *
    100
  ) / 100;
};


/* =========================================================
   GET SHIPPING RATE
   ========================================================= */

const getShippingRate =
async (
  supabase,
  distanceKm
) => {

  const {
    data: shippingRates,
    error
  } =
    await supabase
      .from(
        'shipping_settings'
      )
      .select(`
        id,
        min_distance,
        max_distance,
        fee,
        active
      `)
      .eq(
        'active',
        true
      )
      .order(
        'max_distance',
        {
          ascending:
            true
        }
      );


  if (error) {

    console.error(
      'SHIPPING RATE LOOKUP ERROR:',
      error
    );


    throw new Error(
      'Failed to load shipping rates'
    );
  }


  if (
    !Array.isArray(
      shippingRates
    ) ||
    shippingRates.length === 0
  ) {

    throw new Error(
      'No active shipping rates configured'
    );
  }


  /*
   * Contoh:
   *
   * 0 - 2 KM
   * 2 - 5 KM
   * 5 - 8 KM
   *
   * Kalau jarak tepat 2 KM,
   * tier pertama dipilih karena
   * list sudah diurutkan max_distance.
   */

  const matchedRate =
    shippingRates.find(
      (rate) => {

        const minDistance =
          Number(
            rate.min_distance
          );


        const maxDistance =
          Number(
            rate.max_distance
          );


        if (
          !Number.isFinite(
            minDistance
          ) ||
          !Number.isFinite(
            maxDistance
          )
        ) {

          return false;
        }


        return (
          distanceKm >=
            minDistance &&
          distanceKm <=
            maxDistance
        );
      }
    );


  if (!matchedRate) {

    return null;
  }


  const fee =
    Number(
      matchedRate.fee
    );


  if (
    !Number.isInteger(
      fee
    ) ||
    fee < 0
  ) {

    throw new Error(
      `Invalid shipping fee configuration for rate '${matchedRate.id}'`
    );
  }


  return {
    id:
      matchedRate.id,

    min_distance:
      Number(
        matchedRate.min_distance
      ),

    max_distance:
      Number(
        matchedRate.max_distance
      ),

    fee
  };
};


/* =========================================================
   NORMALIZE DELIVERY REQUEST
   ========================================================= */

/*
 * Delivery dianggap aktif jika frontend mengirim:
 *
 * {
 *   "delivery": {
 *     "enabled": true,
 *     "address": "...",
 *     "latitude": -6.xxx,
 *     "longitude": 106.xxx
 *   }
 * }
 *
 * Juga support:
 *
 * type: "delivery"
 */

const normalizeDelivery =
(delivery) => {

  if (
    !delivery ||
    typeof delivery !==
      'object'
  ) {

    return {
      enabled:
        false,

      type:
        'pickup',

      address:
        null,

      latitude:
        null,

      longitude:
        null
    };
  }


  const type =
    String(
      delivery.type ||
      ''
    )
      .trim()
      .toLowerCase();


  const enabled =
    delivery.enabled ===
      true ||
    type ===
      'delivery';


  if (!enabled) {

    return {
      enabled:
        false,

      type:
        'pickup',

      address:
        null,

      latitude:
        null,

      longitude:
        null
    };
  }


  const latitude =
    toFiniteNumber(
      delivery.latitude
    );


  const longitude =
    toFiniteNumber(
      delivery.longitude
    );


  const address =
    delivery.address
      ? String(
          delivery.address
        ).trim()
      : '';


  return {
    enabled:
      true,

    type:
      'delivery',

    address,

    latitude,

    longitude
  };
};


/* =========================================================
   EXISTING ORDER RESPONSE
   ========================================================= */

const getExistingOrderResponse =
async (
  supabase,
  order
) => {

  const {
    data: items,
    error: itemsError
  } =
    await supabase
      .from(
        'order_items'
      )
      .select(
        '*'
      )
      .eq(
        'order_number',
        order.order_number
      );


  if (
    itemsError
  ) {

    console.error(
      'Existing order items lookup error:',
      itemsError
    );
  }


  let payment =
    null;


  if (
    order.payment_provider ===
      'xendit' &&
    order.payment_id &&
    order.payment_url
  ) {

    payment = {
      provider:
        'xendit',

      session_id:
        order.payment_id,

      redirect_url:
        order.payment_url,

      payment_link_url:
        order.payment_url
    };
  }


  const isDelivery =
    order.delivery_type ===
      'delivery';


  return {
    checkout_id:
      order.checkout_id,

    order_number:
      order.order_number,

    subtotal_amount:
      Number(
        order.subtotal_amount ??
        order.total_amount ??
        0
      ),

    shipping_fee:
      Number(
        order.shipping_fee ??
        0
      ),

    total_amount:
      Number(
        order.total_amount ??
        0
      ),

    status:
      order.status,

    customer: {
      name:
        order.customer_name,

      email:
        order.customer_email,

      phone:
        order.customer_phone
    },

    delivery: {
      type:
        isDelivery
          ? 'delivery'
          : 'pickup',

      enabled:
        isDelivery,

      address:
        isDelivery
          ? (
              order.delivery_address ||
              null
            )
          : null,

      latitude:
        isDelivery
          ? (
              order.delivery_latitude ??
              null
            )
          : null,

      longitude:
        isDelivery
          ? (
              order.delivery_longitude ??
              null
            )
          : null,

      distance_km:
        isDelivery
          ? (
              order.delivery_distance_km ??
              null
            )
          : null,

      shipping_fee:
        Number(
          order.shipping_fee ??
          0
        )
    },

    items:
      items ||
      [],

    notes:
      order.notes ||
      null,

    payment,

    payment_provider:
      order.payment_provider ||
      null,

    payment_id:
      order.payment_id ||
      null,

    payment_method:
      order.payment_method ||
      null,

    payment_url:
      order.payment_url ||
      null,

    paid_at:
      order.paid_at ||
      null,

    created_at:
      order.created_at,

    idempotent:
      true
  };
};


/* =========================================================
   CREATE ORDER
   POST /api/orders
   ========================================================= */

export const createOrder =
async (c) => {

  try {

    const body =
      await c.req
        .json()
        .catch(
          () => ({})
        );


    const {
      customer,
      items,
      notes,
      checkout_id,
      delivery
    } = body;


    /* -----------------------------------------------------
       1. CHECKOUT ID
       ----------------------------------------------------- */

    if (
      !checkout_id
    ) {

      return errorResponse(
        c,
        'Checkout ID is required',
        'checkout_id is required',
        400
      );
    }


    /* -----------------------------------------------------
       2. CUSTOMER
       ----------------------------------------------------- */

    if (
      !customer ||
      !customer.name ||
      !String(
        customer.name
      ).trim()
    ) {

      return errorResponse(
        c,
        'Invalid customer information',
        'Customer name is required',
        400
      );
    }


    /* -----------------------------------------------------
       3. ITEMS
       ----------------------------------------------------- */

    if (
      !Array.isArray(
        items
      ) ||
      items.length ===
        0
    ) {

      return errorResponse(
        c,
        'Invalid items',
        'Order must contain at least one product item',
        400
      );
    }


    /* -----------------------------------------------------
       4. SUPABASE
       ----------------------------------------------------- */

    const supabase =
      getSupabaseClient(
        c.env
      );


    if (
      !supabase
    ) {

      return errorResponse(
        c,
        'Database unavailable',
        'Supabase connection unavailable',
        503
      );
    }


    /* -----------------------------------------------------
       5. IDEMPOTENT CHECKOUT
       ----------------------------------------------------- */

    const {
      data:
        existingOrder,

      error:
        existingOrderError
    } =
      await supabase
        .from(
          'orders'
        )
        .select(
          '*'
        )
        .eq(
          'checkout_id',
          checkout_id
        )
        .maybeSingle();


    if (
      existingOrderError
    ) {

      console.error(
        'Checkout lookup error:',
        existingOrderError
      );
    }


    if (
      existingOrder
    ) {

      const existingResponse =
        await getExistingOrderResponse(
          supabase,
          existingOrder
        );


      return successResponse(
        c,
        existingResponse,
        'Existing checkout returned',
        200
      );
    }


    /* -----------------------------------------------------
       6. NORMALIZE PRODUCT IDS
       ----------------------------------------------------- */

    const productIds =
      Array.from(
        new Set(
          items
            .map(
              (item) => {

                return normalizeProductId(
                  item.product_id ||
                  item.id
                );
              }
            )
            .filter(
              Boolean
            )
        )
      );


    /* -----------------------------------------------------
       7. LOAD PRODUCTS
       ----------------------------------------------------- */

    const dbProducts =
      await getProductsByIds(
        c.env,
        productIds
      );


    const dbProductMap =
      new Map(
        dbProducts.map(
          (
            product
          ) => [

            String(
              product.id
            ),

            product

          ]
        )
      );


    /* -----------------------------------------------------
       8. VALIDATE PRODUCTS
       ----------------------------------------------------- */

    let calculatedSubtotal =
      0;


    const validatedOrderItems =
      [];


    for (
      const item of items
    ) {

      const pid =
        normalizeProductId(
          item.product_id ||
          item.id
        );


      const quantity =
        parseInt(
          item.quantity,
          10
        );


      if (
        !pid
      ) {

        return errorResponse(
          c,
          'Invalid product',
          'Product ID is required',
          400
        );
      }


      if (
        Number.isNaN(
          quantity
        ) ||
        quantity <=
          0
      ) {

        return errorResponse(
          c,
          'Invalid quantity',
          `Invalid quantity for product ${pid}`,
          400
        );
      }


      if (
        quantity >
        100
      ) {

        return errorResponse(
          c,
          'Invalid quantity',
          'Maximum quantity is 100',
          400
        );
      }


      const dbProduct =
        dbProductMap.get(
          pid
        );


      if (
        !dbProduct
      ) {

        console.error(
          'PRODUCT NOT FOUND:',
          {
            requestedProductId:
              pid,

            rawProductId:
              item.product_id ||
              item.id,

            availableProducts:
              dbProducts.map(
                (p) =>
                  p.id
              )
          }
        );


        return errorResponse(
          c,
          'Product not found',
          `Product '${pid}' does not exist`,
          400
        );
      }


      if (
        dbProduct.is_active ===
        false
      ) {

        return errorResponse(
          c,
          'Product unavailable',
          `${dbProduct.name} is unavailable`,
          400
        );
      }


      /* ---------------------------------------------------
         STOCK VALIDATION
         --------------------------------------------------- */

      const stock =
        Number(
          dbProduct.stock
        );


      if (
        Number.isFinite(
          stock
        ) &&
        quantity >
          stock
      ) {

        return errorResponse(
          c,
          'Maaf, stok menu ini sedang habis.',
          `Stok ${dbProduct.name} tersedia ${stock}, sedangkan pesanan ${quantity}`,
          400
        );
      }


      /* ---------------------------------------------------
         TRUSTED PRICE FROM DATABASE
         --------------------------------------------------- */

      const unitPrice =
        Number(
          dbProduct.price
        );


      if (
        !Number.isFinite(
          unitPrice
        ) ||
        unitPrice <=
          0
      ) {

        return errorResponse(
          c,
          'Invalid product price',
          `Invalid price for ${dbProduct.name}`,
          500
        );
      }


      const subtotal =
        unitPrice *
        quantity;


      calculatedSubtotal +=
        subtotal;


      validatedOrderItems.push({
        product_id:
          String(
            dbProduct.id
          ),

        product_name:
          dbProduct.name,

        price:
          unitPrice,

        quantity,

        subtotal
      });
    }


    /* -----------------------------------------------------
       9. DELIVERY / SHIPPING
       ----------------------------------------------------- */

    const normalizedDelivery =
      normalizeDelivery(
        delivery
      );


    let shippingFee =
      0;


    let deliveryDistanceKm =
      null;


    let matchedShippingRate =
      null;


    /*
     * PICKUP
     */

    if (
      !normalizedDelivery.enabled
    ) {

      shippingFee =
        0;
    }


    /*
     * DELIVERY
     */

    else {

      if (
        !normalizedDelivery.address
      ) {

        return errorResponse(
          c,
          'Delivery address required',
          'Delivery address is required',
          400
        );
      }


      if (
        normalizedDelivery.latitude ===
          null ||
        normalizedDelivery.longitude ===
          null
      ) {

        return errorResponse(
          c,
          'Delivery location required',
          'Customer latitude and longitude are required for delivery',
          400
        );
      }


      if (
        normalizedDelivery.latitude <
          -90 ||
        normalizedDelivery.latitude >
          90
      ) {

        return errorResponse(
          c,
          'Invalid latitude',
          'Customer latitude must be between -90 and 90',
          400
        );
      }


      if (
        normalizedDelivery.longitude <
          -180 ||
        normalizedDelivery.longitude >
          180
      ) {

        return errorResponse(
          c,
          'Invalid longitude',
          'Customer longitude must be between -180 and 180',
          400
        );
      }


      const rawDistance =
        calculateDistanceKm(

          STORE_LOCATION.latitude,

          STORE_LOCATION.longitude,

          normalizedDelivery.latitude,

          normalizedDelivery.longitude

        );


      if (
        !Number.isFinite(
          rawDistance
        )
      ) {

        return errorResponse(
          c,
          'Invalid delivery distance',
          'Unable to calculate delivery distance',
          400
        );
      }


      deliveryDistanceKm =
        roundDistance(
          rawDistance
        );


      matchedShippingRate =
        await getShippingRate(
          supabase,
          deliveryDistanceKm
        );


      if (
        !matchedShippingRate
      ) {

        return errorResponse(
          c,
          'Lokasi di luar jangkauan pengiriman',
          `Jarak pengiriman ${deliveryDistanceKm} KM tidak masuk tarif pengiriman yang tersedia`,
          400
        );
      }


      shippingFee =
        matchedShippingRate.fee;
    }


    /* -----------------------------------------------------
       10. CALCULATE TRUSTED TOTAL
       ----------------------------------------------------- */

    const calculatedTotalAmount =
      calculatedSubtotal +
      shippingFee;


    /* -----------------------------------------------------
       11. ORDER NUMBER
       ----------------------------------------------------- */

    const orderNumber =
      `ARC-${Date.now()}-${Math.floor(
        1000 +
        Math.random() *
        9000
      )}`;


    /* -----------------------------------------------------
       12. SAVE CUSTOMER HISTORY
       ----------------------------------------------------- */

    const {
      error:
        customerError
    } =
      await supabase
        .from(
          'customers'
        )
        .insert({
          name:
            String(
              customer.name
            ).trim(),

          email:
            customer.email
              ? String(
                  customer.email
                ).trim()
              : null,

          phone:
            customer.phone
              ? String(
                  customer.phone
                ).trim()
              : null
        });


    if (
      customerError
    ) {

      console.warn(
        'Customer insert warning:',
        customerError
      );
    }


    /* -----------------------------------------------------
       13. CREATE ORDER
       ----------------------------------------------------- */

    const {
      data:
        orderData,

      error:
        orderError
    } =
      await supabase
        .from(
          'orders'
        )
        .insert({
          checkout_id,

          order_number:
            orderNumber,

          customer_name:
            String(
              customer.name
            ).trim(),

          customer_email:
            customer.email
              ? String(
                  customer.email
                ).trim()
              : null,

          customer_phone:
            customer.phone
              ? String(
                  customer.phone
                ).trim()
              : null,


          /* -----------------------------------------------
             PRICE
             ----------------------------------------------- */

          subtotal_amount:
            calculatedSubtotal,

          shipping_fee:
            shippingFee,

          total_amount:
            calculatedTotalAmount,


          /* -----------------------------------------------
             DELIVERY
             ----------------------------------------------- */

          delivery_type:
            normalizedDelivery.enabled
              ? 'delivery'
              : 'pickup',

          delivery_address:
            normalizedDelivery.enabled
              ? normalizedDelivery.address
              : null,

          delivery_latitude:
            normalizedDelivery.enabled
              ? normalizedDelivery.latitude
              : null,

          delivery_longitude:
            normalizedDelivery.enabled
              ? normalizedDelivery.longitude
              : null,

          delivery_distance_km:
            normalizedDelivery.enabled
              ? deliveryDistanceKm
              : null,


          /* -----------------------------------------------
             ORDER STATUS
             ----------------------------------------------- */

          status:
            'pending',

          notes:
            notes ||
            null,

          payment_provider:
            null,

          payment_id:
            null,

          payment_method:
            null,

          payment_url:
            null,

          paid_at:
            null,

          snap_token:
            null,

          stock_processed:
            false,

          stock_restored:
            false
        })
        .select()
        .single();


    /* -----------------------------------------------------
       ORDER INSERT ERROR
       ----------------------------------------------------- */

    if (
      orderError
    ) {

      console.error(
        'ORDER INSERT FAILED:',
        orderError
      );


      const {
        data:
          duplicateOrder
      } =
        await supabase
          .from(
            'orders'
          )
          .select(
            '*'
          )
          .eq(
            'checkout_id',
            checkout_id
          )
          .maybeSingle();


      if (
        duplicateOrder
      ) {

        const duplicateResponse =
          await getExistingOrderResponse(
            supabase,
            duplicateOrder
          );


        return successResponse(
          c,
          duplicateResponse,
          'Duplicate checkout prevented',
          200
        );
      }


      return errorResponse(
        c,
        'Failed to create order',
        orderError.message,
        500
      );
    }


    /* -----------------------------------------------------
       14. SAVE ORDER ITEMS
       ----------------------------------------------------- */

    const orderItemsPayload =
      validatedOrderItems.map(
        (
          item
        ) => ({
          order_id:
            orderData.id,

          order_number:
            orderNumber,

          product_id:
            item.product_id,

          product_name:
            item.product_name,

          price:
            item.price,

          quantity:
            item.quantity,

          subtotal:
            item.subtotal
        })
      );


    const {
      error:
        orderItemsError
    } =
      await supabase
        .from(
          'order_items'
        )
        .insert(
          orderItemsPayload
        );


    if (
      orderItemsError
    ) {

      console.error(
        'ORDER ITEMS INSERT FAILED:',
        orderItemsError
      );


      await supabase
        .from(
          'orders'
        )
        .update({
          status:
            'failed'
        })
        .eq(
          'id',
          orderData.id
        );


      return errorResponse(
        c,
        'Failed to save order items',
        orderItemsError.message,
        500
      );
    }


    /* -----------------------------------------------------
       15. FINAL ORDER RESPONSE
       ----------------------------------------------------- */

    const finalOrderResponse = {
      checkout_id,

      order_number:
        orderNumber,

      subtotal_amount:
        calculatedSubtotal,

      shipping_fee:
        shippingFee,

      total_amount:
        calculatedTotalAmount,

      status:
        'pending',

      customer: {
        name:
          String(
            customer.name
          ).trim(),

        email:
          customer.email
            ? String(
                customer.email
              ).trim()
            : null,

        phone:
          customer.phone
            ? String(
                customer.phone
              ).trim()
            : null
      },

      delivery: {
        type:
          normalizedDelivery.enabled
            ? 'delivery'
            : 'pickup',

        enabled:
          normalizedDelivery.enabled,

        address:
          normalizedDelivery.enabled
            ? normalizedDelivery.address
            : null,

        latitude:
          normalizedDelivery.enabled
            ? normalizedDelivery.latitude
            : null,

        longitude:
          normalizedDelivery.enabled
            ? normalizedDelivery.longitude
            : null,

        distance_km:
          normalizedDelivery.enabled
            ? deliveryDistanceKm
            : null,

        shipping_fee:
          shippingFee,

        rate:
          matchedShippingRate
            ? {
                id:
                  matchedShippingRate.id,

                min_distance:
                  matchedShippingRate.min_distance,

                max_distance:
                  matchedShippingRate.max_distance
              }
            : null
      },

      items:
        validatedOrderItems,

      notes:
        notes ||
        null,

      payment:
        null,

      payment_provider:
        null,

      payment_id:
        null,

      payment_method:
        null,

      payment_url:
        null,

      created_at:
        orderData.created_at ||
        new Date()
          .toISOString()
    };


    inMemoryOrdersMap.set(
      orderNumber,
      finalOrderResponse
    );


    return successResponse(
      c,
      finalOrderResponse,
      'Order created successfully',
      201
    );


  } catch (
    err
  ) {

    console.error(
      'Create Order Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to create order',
      err?.message ||
      err,
      500
    );
  }
};


/* =========================================================
   GET ORDER
   GET /api/orders/:orderNumber
   ========================================================= */

export const getOrderByNumber =
async (c) => {

  try {

    const orderNumber =
      c.req.param(
        'orderNumber'
      );


    if (
      !orderNumber
    ) {

      return errorResponse(
        c,
        'Order number is required',
        null,
        400
      );
    }


    const supabase =
      getSupabaseClient(
        c.env
      );


    if (
      supabase
    ) {

      const {
        data:
          order,

        error:
          orderError
      } =
        await supabase
          .from(
            'orders'
          )
          .select(
            '*'
          )
          .eq(
            'order_number',
            orderNumber
          )
          .maybeSingle();


      if (
        !orderError &&
        order
      ) {

        const {
          data:
            items,

          error:
            itemsError
        } =
          await supabase
            .from(
              'order_items'
            )
            .select(
              '*'
            )
            .eq(
              'order_number',
              orderNumber
            );


        if (
          itemsError
        ) {

          console.error(
            'Order items lookup error:',
            itemsError
          );
        }


        const {
          data:
            payments,

          error:
            paymentsError
        } =
          await supabase
            .from(
              'payments'
            )
            .select(
              '*'
            )
            .eq(
              'order_number',
              orderNumber
            )
            .order(
              'created_at',
              {
                ascending:
                  false
              }
            );


        if (
          paymentsError
        ) {

          console.error(
            'Payment history lookup error:',
            paymentsError
          );
        }


        const isDelivery =
          order.delivery_type ===
            'delivery';


        return successResponse(
          c,
          {
            ...order,

            subtotal_amount:
              Number(
                order.subtotal_amount ??
                order.total_amount ??
                0
              ),

            shipping_fee:
              Number(
                order.shipping_fee ??
                0
              ),

            total_amount:
              Number(
                order.total_amount ??
                0
              ),

            delivery: {
              type:
                isDelivery
                  ? 'delivery'
                  : 'pickup',

              enabled:
                isDelivery,

              address:
                isDelivery
                  ? (
                      order.delivery_address ||
                      null
                    )
                  : null,

              latitude:
                isDelivery
                  ? (
                      order.delivery_latitude ??
                      null
                    )
                  : null,

              longitude:
                isDelivery
                  ? (
                      order.delivery_longitude ??
                      null
                    )
                  : null,

              distance_km:
                isDelivery
                  ? (
                      order.delivery_distance_km ??
                      null
                    )
                  : null,

              shipping_fee:
                Number(
                  order.shipping_fee ??
                  0
                )
            },

            items:
              items ||
              [],

            payments:
              payments ||
              [],

            payment:
              (
                order.payment_provider ===
                  'xendit' &&
                order.payment_id &&
                order.payment_url
              )
                ? {
                    provider:
                      'xendit',

                    session_id:
                      order.payment_id,

                    redirect_url:
                      order.payment_url,

                    payment_link_url:
                      order.payment_url
                  }
                : null
          },
          'Order details retrieved successfully'
        );
      }
    }


    if (
      inMemoryOrdersMap.has(
        orderNumber
      )
    ) {

      return successResponse(
        c,
        inMemoryOrdersMap.get(
          orderNumber
        ),
        'Order details retrieved successfully'
      );
    }


    return errorResponse(
      c,
      'Order not found',
      `No order found with order number ${orderNumber}`,
      404
    );


  } catch (
    err
  ) {

    return errorResponse(
      c,
      'Failed to fetch order details',
      err?.message ||
      err,
      500
    );
  }
};


/* =========================================================
   PUBLIC ORDER STATUS
   GET /api/order-status/:orderNumber
   ========================================================= */

/*
 * Endpoint ini sengaja hanya mengembalikan
 * data status yang aman ditampilkan ke customer.
 *
 * Tidak mengembalikan:
 * email
 * phone
 * alamat
 * koordinat
 * payment raw data
 */

export const getPublicOrderStatus =
async (c) => {

  try {

    const orderNumber =
      String(
        c.req.param(
          'orderNumber'
        ) ||
        ''
      ).trim();


    if (
      !orderNumber
    ) {

      return errorResponse(
        c,
        'Order number is required',
        null,
        400
      );
    }


    const supabase =
      getSupabaseClient(
        c.env
      );


    if (
      !supabase
    ) {

      return errorResponse(
        c,
        'Database unavailable',
        'Supabase connection unavailable',
        503
      );
    }


    const {
      data:
        order,

      error:
        orderError
    } =
      await supabase
        .from(
          'orders'
        )
        .select(`
          order_number,
          status,
          subtotal_amount,
          shipping_fee,
          total_amount,
          delivery_type,
          created_at,
          paid_at,
          updated_at
        `)
        .eq(
          'order_number',
          orderNumber
        )
        .maybeSingle();


    if (
      orderError
    ) {

      console.error(
        'PUBLIC ORDER STATUS ERROR:',
        orderError
      );


      return errorResponse(
        c,
        'Failed to load order status',
        orderError.message,
        500
      );
    }


    if (
      !order
    ) {

      return errorResponse(
        c,
        'Order not found',
        `Order '${orderNumber}' does not exist`,
        404
      );
    }


    const status =
      String(
        order.status ||
        'pending'
      )
        .trim()
        .toLowerCase();


    return successResponse(
      c,
      {
        order_number:
          order.order_number,

        status,

        status_label:
          getOrderStatusLabel(
            status
          ),

        subtotal_amount:
          Number(
            order.subtotal_amount ??
            0
          ),

        shipping_fee:
          Number(
            order.shipping_fee ??
            0
          ),

        total_amount:
          Number(
            order.total_amount ??
            0
          ),

        delivery_type:
          order.delivery_type ||
          'pickup',

        created_at:
          order.created_at ||
          null,

        paid_at:
          order.paid_at ||
          null,

        updated_at:
          order.updated_at ||
          null
      },
      'Order status retrieved successfully'
    );


  } catch (
    err
  ) {

    console.error(
      'Get Public Order Status Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to load order status',
      err?.message ||
      err,
      500
    );
  }
};


/* =========================================================
   ADMIN - GET ORDERS
   GET /api/admin/orders
   ========================================================= */

export const getAdminOrders =
async (c) => {

  try {

    /* -----------------------------------------------------
       ADMIN AUTH
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       SUPABASE
       ----------------------------------------------------- */

    const supabase =
      getSupabaseClient(
        c.env
      );


    if (
      !supabase
    ) {

      return errorResponse(
        c,
        'Database unavailable',
        'Supabase connection unavailable',
        503
      );
    }


    /* -----------------------------------------------------
       LOAD ORDERS
       ----------------------------------------------------- */

    const {
      data:
        orders,

      error:
        ordersError
    } =
      await supabase
        .from(
          'orders'
        )
        .select(`
          id,
          checkout_id,
          order_number,
          customer_name,
          customer_email,
          customer_phone,
          subtotal_amount,
          shipping_fee,
          total_amount,
          delivery_type,
          delivery_address,
          delivery_distance_km,
          status,
          notes,
          payment_provider,
          payment_method,
          payment_id,
          payment_url,
          paid_at,
          stock_processed,
          stock_restored,
          created_at,
          updated_at
        `)
        .order(
          'created_at',
          {
            ascending:
              false
          }
        )
        .limit(
          100
        );


    if (
      ordersError
    ) {

      console.error(
        'ADMIN ORDERS ERROR:',
        ordersError
      );


      return errorResponse(
        c,
        'Failed to load orders',
        ordersError.message,
        500
      );
    }


    const safeOrders =
      Array.isArray(
        orders
      )
        ? orders
        : [];


    /* -----------------------------------------------------
       NO ORDERS
       ----------------------------------------------------- */

    if (
      safeOrders.length ===
      0
    ) {

      return successResponse(
        c,
        {
          orders:
            []
        },
        'Orders loaded successfully'
      );
    }


    /* -----------------------------------------------------
       LOAD ORDER ITEMS
       ----------------------------------------------------- */

    const orderNumbers =
      safeOrders
        .map(
          order =>
            order.order_number
        )
        .filter(
          Boolean
        );


    let allItems =
      [];


    if (
      orderNumbers.length >
      0
    ) {

      const {
        data:
          items,

        error:
          itemsError
      } =
        await supabase
          .from(
            'order_items'
          )
          .select(`
            id,
            order_id,
            order_number,
            product_id,
            product_name,
            price,
            quantity,
            subtotal
          `)
          .in(
            'order_number',
            orderNumbers
          );


      if (
        itemsError
      ) {

        console.error(
          'ADMIN ORDER ITEMS ERROR:',
          itemsError
        );

      } else {

        allItems =
          Array.isArray(
            items
          )
            ? items
            : [];
      }
    }


    /* -----------------------------------------------------
       MERGE ITEMS
       ----------------------------------------------------- */

    const result =
      safeOrders.map(
        order => {

          const orderItems =
            allItems.filter(
              item =>
                item.order_number ===
                order.order_number
            );


          const status =
            String(
              order.status ||
              'pending'
            )
              .trim()
              .toLowerCase();


          return {
            ...order,

            subtotal_amount:
              Number(
                order.subtotal_amount ??
                0
              ),

            shipping_fee:
              Number(
                order.shipping_fee ??
                0
              ),

            total_amount:
              Number(
                order.total_amount ??
                0
              ),

            delivery_distance_km:
              order.delivery_distance_km !==
              null
                ? Number(
                    order.delivery_distance_km
                  )
                : null,

            status,

            status_label:
              getOrderStatusLabel(
                status
              ),

            items:
              orderItems
          };
        }
      );


    return successResponse(
      c,
      {
        orders:
          result
      },
      'Orders loaded successfully'
    );


  } catch (
    err
  ) {

    console.error(
      'Get Admin Orders Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to load orders',
      err?.message ||
      err,
      500
    );
  }
};


/* =========================================================
   ADMIN - UPDATE ORDER STATUS
   PATCH /api/admin/orders/:orderNumber/status
   ========================================================= */

export const updateAdminOrderStatus =
async (c) => {

  try {

    /* -----------------------------------------------------
       ADMIN AUTH
       ----------------------------------------------------- */

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


    /* -----------------------------------------------------
       ORDER NUMBER
       ----------------------------------------------------- */

    const orderNumber =
      String(
        c.req.param(
          'orderNumber'
        ) ||
        ''
      ).trim();


    if (
      !orderNumber
    ) {

      return errorResponse(
        c,
        'Order number is required',
        null,
        400
      );
    }


    /* -----------------------------------------------------
       BODY
       ----------------------------------------------------- */

    const body =
      await c.req
        .json()
        .catch(
          () => ({})
        );


    const status =
      String(
        body?.status ||
        ''
      )
        .trim()
        .toLowerCase();


    /* -----------------------------------------------------
       STATUS VALIDATION
       ----------------------------------------------------- */

    if (
      !ADMIN_ALLOWED_ORDER_STATUSES.has(
        status
      )
    ) {

      return errorResponse(
        c,
        'Invalid order status',
        `Status '${status}' is not allowed`,
        400
      );
    }


    /* -----------------------------------------------------
       SUPABASE
       ----------------------------------------------------- */

    const supabase =
      getSupabaseClient(
        c.env
      );


    if (
      !supabase
    ) {

      return errorResponse(
        c,
        'Database unavailable',
        'Supabase connection unavailable',
        503
      );
    }


    /* -----------------------------------------------------
       FIND ORDER
       ----------------------------------------------------- */

    const {
      data:
        currentOrder,

      error:
        lookupError
    } =
      await supabase
        .from(
          'orders'
        )
        .select(`
          id,
          order_number,
          status,
          paid_at,
          total_amount,
          customer_name,
          delivery_type
        `)
        .eq(
          'order_number',
          orderNumber
        )
        .maybeSingle();


    if (
      lookupError
    ) {

      console.error(
        'ADMIN ORDER LOOKUP ERROR:',
        lookupError
      );


      return errorResponse(
        c,
        'Failed to find order',
        lookupError.message,
        500
      );
    }


    if (
      !currentOrder
    ) {

      return errorResponse(
        c,
        'Order not found',
        `Order '${orderNumber}' does not exist`,
        404
      );
    }


    /* -----------------------------------------------------
       IMPORTANT SECURITY

       Jangan sampai admin secara tidak sengaja
       menandai order pending sebagai ready/completed
       padahal belum dibayar.
       ----------------------------------------------------- */

    if (
      (
        status ===
          'ready' ||
        status ===
          'completed'
      ) &&
      (
        currentOrder.status ===
          'pending' ||
        currentOrder.status ===
          'failed'
      )
    ) {

      return errorResponse(
        c,
        'Order has not been paid',
        'Only paid orders can be marked ready or completed',
        400
      );
    }


    /* -----------------------------------------------------
       IDEMPOTENT STATUS
       ----------------------------------------------------- */

    if (
      currentOrder.status ===
      status
    ) {

      return successResponse(
        c,
        {
          order_number:
            currentOrder.order_number,

          status,

          status_label:
            getOrderStatusLabel(
              status
            ),

          idempotent:
            true
        },
        'Order status already updated'
      );
    }


    /* -----------------------------------------------------
       UPDATE
       ----------------------------------------------------- */

    const now =
      new Date()
        .toISOString();


    const {
      data:
        updatedOrder,

      error:
        updateError
    } =
      await supabase
        .from(
          'orders'
        )
        .update({
          status,

          updated_at:
            now
        })
        .eq(
          'id',
          currentOrder.id
        )
        .select(`
          id,
          order_number,
          customer_name,
          total_amount,
          delivery_type,
          status,
          paid_at,
          created_at,
          updated_at
        `)
        .single();


    if (
      updateError
    ) {

      console.error(
        'ADMIN STATUS UPDATE ERROR:',
        updateError
      );


      return errorResponse(
        c,
        'Failed to update order status',
        updateError.message,
        500
      );
    }


    /* -----------------------------------------------------
       MEMORY FALLBACK SYNC
       ----------------------------------------------------- */

    if (
      inMemoryOrdersMap.has(
        orderNumber
      )
    ) {

      const memoryOrder =
        inMemoryOrdersMap.get(
          orderNumber
        );


      inMemoryOrdersMap.set(
        orderNumber,
        {
          ...memoryOrder,

          status,

          updated_at:
            now
        }
      );
    }


    /* -----------------------------------------------------
       RESPONSE
       ----------------------------------------------------- */

    return successResponse(
      c,
      {
        ...updatedOrder,

        total_amount:
          Number(
            updatedOrder.total_amount ??
            0
          ),

        status_label:
          getOrderStatusLabel(
            status
          )
      },
      'Order status updated successfully'
    );


  } catch (
    err
  ) {

    console.error(
      'Update Admin Order Status Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to update order status',
      err?.message ||
      err,
      500
    );
  }
};


/* =========================================================
   UPDATE ORDER STATUS
   ========================================================= */

export const updateOrderStatus =
async (
  env,
  orderNumber,
  newStatus,
  paymentDetails = {}
) => {

  const supabase =
    getSupabaseClient(
      env
    );


  /* -------------------------------------------------------
     MEMORY
     ------------------------------------------------------- */

  if (
    inMemoryOrdersMap.has(
      orderNumber
    )
  ) {

    const existing =
      inMemoryOrdersMap.get(
        orderNumber
      );


    inMemoryOrdersMap.set(
      orderNumber,
      {
        ...existing,

        status:
          newStatus,

        payment_details:
          paymentDetails,

        updated_at:
          new Date()
            .toISOString()
      }
    );
  }


  /* -------------------------------------------------------
     DATABASE
     ------------------------------------------------------- */

  if (
    supabase
  ) {

    const {
      error
    } =
      await supabase
        .from(
          'orders'
        )
        .update({
          status:
            newStatus,

          updated_at:
            new Date()
              .toISOString()
        })
        .eq(
          'order_number',
          orderNumber
        );


    if (
      error
    ) {

      console.error(
        'UPDATE ORDER STATUS ERROR:',
        error
      );


      throw error;
    }
  }
};


/* =========================================================
   STOCK MANAGEMENT
   ========================================================= */

/*
 * mode:
 *
 * decrease = payment successful
 * increase = refund
 */

export const adjustStockForOrder =
async (
  env,
  orderNumber,
  mode = 'decrease'
) => {

  const supabase =
    getSupabaseClient(
      env
    );


  if (
    !supabase
  ) {

    throw new Error(
      'Supabase unavailable'
    );
  }


  if (
    mode !==
      'decrease' &&
    mode !==
      'increase'
  ) {

    throw new Error(
      `Invalid stock mode '${mode}'`
    );
  }


  /* -------------------------------------------------------
     FIND ORDER
     ------------------------------------------------------- */

  const {
    data:
      order,

    error:
      orderError
  } =
    await supabase
      .from(
        'orders'
      )
      .select(`
        id,
        order_number,
        stock_processed,
        stock_restored
      `)
      .eq(
        'order_number',
        orderNumber
      )
      .maybeSingle();


  if (
    orderError ||
    !order
  ) {

    throw new Error(
      `Order '${orderNumber}' not found`
    );
  }


  /* -------------------------------------------------------
     PREVENT DOUBLE DEDUCTION
     ------------------------------------------------------- */

  if (
    mode ===
      'decrease' &&
    order.stock_processed
  ) {

    return {
      success:
        true,

      skipped:
        true,

      reason:
        'Stock already deducted'
    };
  }


  /* -------------------------------------------------------
     PREVENT DOUBLE RESTORE
     ------------------------------------------------------- */

  if (
    mode ===
      'increase' &&
    order.stock_restored
  ) {

    return {
      success:
        true,

      skipped:
        true,

      reason:
        'Stock already restored'
    };
  }


  /* -------------------------------------------------------
     GET ORDER ITEMS
     ------------------------------------------------------- */

  const {
    data:
      items,

    error:
      itemsError
  } =
    await supabase
      .from(
        'order_items'
      )
      .select(
        'product_id, quantity'
      )
      .eq(
        'order_number',
        orderNumber
      );


  if (
    itemsError
  ) {

    throw itemsError;
  }


  if (
    !items ||
    items.length ===
      0
  ) {

    throw new Error(
      `No order items found for '${orderNumber}'`
    );
  }


  /* -------------------------------------------------------
     UPDATE EACH PRODUCT
     ------------------------------------------------------- */

  for (
    const item of items
  ) {

    const productId =
      normalizeProductId(
        item.product_id
      );


    const {
      data:
        product,

      error:
        productError
    } =
      await supabase
        .from(
          'products'
        )
        .select(
          'id, stock'
        )
        .eq(
          'id',
          productId
        )
        .maybeSingle();


    if (
      productError ||
      !product
    ) {

      throw new Error(
        `Product '${productId}' not found`
      );
    }


    const qty =
      Number(
        item.quantity
      );


    if (
      !Number.isFinite(
        qty
      ) ||
      qty <=
        0
    ) {

      continue;
    }


    const currentStock =
      Number(
        product.stock
      );


    if (
      !Number.isFinite(
        currentStock
      )
    ) {

      throw new Error(
        `Invalid stock for '${productId}'`
      );
    }


    let newStock;


    /* -----------------------------------------------------
       DECREASE
       ----------------------------------------------------- */

    if (
      mode ===
      'decrease'
    ) {

      if (
        currentStock <
        qty
      ) {

        throw new Error(
          `Stok tidak mencukupi untuk '${productId}'. Tersedia ${currentStock}, diminta ${qty}`
        );
      }


      newStock =
        currentStock -
        qty;
    }


    /* -----------------------------------------------------
       INCREASE
       ----------------------------------------------------- */

    else {

      newStock =
        currentStock +
        qty;
    }


    const {
      error:
        updateStockError
    } =
      await supabase
        .from(
          'products'
        )
        .update({
          stock:
            newStock
        })
        .eq(
          'id',
          productId
        );


    if (
      updateStockError
    ) {

      throw updateStockError;
    }
  }


  /* -------------------------------------------------------
     MARK STOCK PROCESSED
     ------------------------------------------------------- */

  if (
    mode ===
      'decrease'
  ) {

    const {
      error
    } =
      await supabase
        .from(
          'orders'
        )
        .update({
          stock_processed:
            true
        })
        .eq(
          'order_number',
          orderNumber
        );


    if (
      error
    ) {

      throw error;
    }
  }


  /* -------------------------------------------------------
     MARK STOCK RESTORED
     ------------------------------------------------------- */

  if (
    mode ===
      'increase'
  ) {

    const {
      error
    } =
      await supabase
        .from(
          'orders'
        )
        .update({
          stock_restored:
            true
        })
        .eq(
          'order_number',
          orderNumber
        );


    if (
      error
    ) {

      throw error;
    }
  }


  return {
    success:
      true,

    skipped:
      false,

    mode,

    order_number:
      orderNumber
  };
};
