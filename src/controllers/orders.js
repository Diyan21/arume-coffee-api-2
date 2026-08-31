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
      .from('order_items')
      .select('*')
      .eq(
        'order_number',
        order.order_number
      );


  if (itemsError) {

    console.error(
      'Existing order items lookup error:',
      itemsError
    );
  }


  let payment =
    null;


  /*
   * Jika order sudah punya
   * Xendit Payment Session.
   */
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


  return {
    checkout_id:
      order.checkout_id,

    order_number:
      order.order_number,

    total_amount:
      order.total_amount,

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

    items:
      items || [],

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
      checkout_id
    } = body;


    /* -----------------------------------------------------
       1. CHECKOUT ID
       ----------------------------------------------------- */

    if (!checkout_id) {

      return errorResponse(
        c,
        'Checkout ID is required',
        'checkout_id is required',
        400
      );
    }


    /* -----------------------------------------------------
       2. CUSTOMER

       Nama wajib.
       Email dan phone opsional.
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
      items.length === 0
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


    if (!supabase) {

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
      data: existingOrder,
      error: existingOrderError
    } =
      await supabase
        .from('orders')
        .select('*')
        .eq(
          'checkout_id',
          checkout_id
        )
        .maybeSingle();


    if (existingOrderError) {

      console.error(
        'Checkout lookup error:',
        existingOrderError
      );
    }


    if (existingOrder) {

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
          (product) => [
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

    let calculatedTotalAmount =
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


      if (!pid) {

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
        quantity <= 0
      ) {

        return errorResponse(
          c,
          'Invalid quantity',
          `Invalid quantity for product ${pid}`,
          400
        );
      }


      if (
        quantity > 100
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


      if (!dbProduct) {

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
                (p) => p.id
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
        quantity > stock
      ) {

        return errorResponse(
          c,
          'Maaf, stok menu ini sedang habis.',
          `Stok ${dbProduct.name} tersedia ${stock}, sedangkan pesanan ${quantity}`,
          400
        );
      }


      /* ---------------------------------------------------
         PRICE FROM DATABASE
         --------------------------------------------------- */

      const unitPrice =
        Number(
          dbProduct.price
        );


      if (
        !Number.isFinite(
          unitPrice
        ) ||
        unitPrice <= 0
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


      calculatedTotalAmount +=
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
       9. ORDER NUMBER
       ----------------------------------------------------- */

    const orderNumber =
      `ARC-${Date.now()}-${Math.floor(
        1000 +
        Math.random() *
        9000
      )}`;


    /* -----------------------------------------------------
       10. SAVE CUSTOMER HISTORY
       ----------------------------------------------------- */

    const {
      error: customerError
    } =
      await supabase
        .from('customers')
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


    if (customerError) {

      /*
       * Customer history bukan
       * data utama checkout.
       */
      console.warn(
        'Customer insert warning:',
        customerError
      );
    }


    /* -----------------------------------------------------
       11. CREATE ORDER
       ----------------------------------------------------- */

    const {
      data: orderData,
      error: orderError
    } =
      await supabase
        .from('orders')
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

          total_amount:
            calculatedTotalAmount,

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

    if (orderError) {

      console.error(
        'ORDER INSERT FAILED:',
        orderError
      );


      /*
       * Request bersamaan dengan
       * checkout_id yang sama.
       */
      const {
        data: duplicateOrder
      } =
        await supabase
          .from('orders')
          .select('*')
          .eq(
            'checkout_id',
            checkout_id
          )
          .maybeSingle();


      if (duplicateOrder) {

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
       12. SAVE ORDER ITEMS
       ----------------------------------------------------- */

    const orderItemsPayload =
      validatedOrderItems.map(
        (item) => ({
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
      error: orderItemsError
    } =
      await supabase
        .from('order_items')
        .insert(
          orderItemsPayload
        );


    if (orderItemsError) {

      console.error(
        'ORDER ITEMS INSERT FAILED:',
        orderItemsError
      );


      await supabase
        .from('orders')
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
       13. FINAL ORDER RESPONSE

       Payment dibuat terpisah lewat:
       POST /api/payment/create
       ----------------------------------------------------- */

    const finalOrderResponse = {
      checkout_id,

      order_number:
        orderNumber,

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


  } catch (err) {

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


    if (!orderNumber) {

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


    if (supabase) {

      const {
        data: order,
        error: orderError
      } =
        await supabase
          .from('orders')
          .select('*')
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
          data: items,
          error: itemsError
        } =
          await supabase
            .from('order_items')
            .select('*')
            .eq(
              'order_number',
              orderNumber
            );


        if (itemsError) {

          console.error(
            'Order items lookup error:',
            itemsError
          );
        }


        const {
          data: payments,
          error: paymentsError
        } =
          await supabase
            .from('payments')
            .select('*')
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


        if (paymentsError) {

          console.error(
            'Payment history lookup error:',
            paymentsError
          );
        }


        return successResponse(
          c,
          {
            ...order,

            items:
              items || [],

            payments:
              payments || [],

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


  } catch (err) {

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

  if (supabase) {

    const {
      error
    } =
      await supabase
        .from('orders')
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


    if (error) {

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


  if (!supabase) {

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
    data: order,
    error: orderError
  } =
    await supabase
      .from('orders')
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
    data: items,
    error: itemsError
  } =
    await supabase
      .from('order_items')
      .select(
        'product_id, quantity'
      )
      .eq(
        'order_number',
        orderNumber
      );


  if (itemsError) {

    throw itemsError;
  }


  if (
    !items ||
    items.length === 0
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
      data: product,
      error: productError
    } =
      await supabase
        .from('products')
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
      qty <= 0
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
      error: updateStockError
    } =
      await supabase
        .from('products')
        .update({
          stock:
            newStock
        })
        .eq(
          'id',
          productId
        );


    if (updateStockError) {

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
        .from('orders')
        .update({
          stock_processed:
            true
        })
        .eq(
          'order_number',
          orderNumber
        );


    if (error) {
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
        .from('orders')
        .update({
          stock_restored:
            true
        })
        .eq(
          'order_number',
          orderNumber
        );


    if (error) {
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
