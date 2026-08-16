import { getSupabaseClient } from '../config/supabase.js';
import { getProductsByIds } from './products.js';
import { createSnapTransaction } from '../config/payment.js';
import { successResponse, errorResponse } from '../utils/response.js';

const inMemoryOrdersMap = new Map();

/**
 * ======================================================
 * PRODUCT ID ALIASES
 * ======================================================
 *
 * Support ID frontend lama dan ID database terbaru.
 *
 * Frontend lama:
 * arumeya-aren-latte
 *
 * Database:
 * prod-01
 */
const PRODUCT_ID_ALIASES = {
  'arumeya-aren-latte': 'prod-01',
  'arumeya-butterscotch': 'prod-02',
  'arumeya-hazelnut-latte': 'prod-03',
  'arumeya-banana-latte': 'prod-04',
  'arumeya-americano': 'prod-05',
};


/**
 * Normalize Product ID
 */
const normalizeProductId = (id) => {
  const rawId = String(id || '');

  return (
    PRODUCT_ID_ALIASES[rawId] ||
    rawId
  );
};


/**
 * ======================================================
 * EXISTING ORDER RESPONSE
 * ======================================================
 */
const getExistingOrderResponse = async (
  supabase,
  order
) => {
  const {
    data: items,
    error: itemsError
  } = await supabase
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
      order.notes || null,

    payment:
      order.snap_token
        ? {
            token:
              order.snap_token,

            redirect_url:
              order.payment_url
          }
        : null,

    created_at:
      order.created_at,

    idempotent:
      true
  };
};


/**
 * ======================================================
 * POST /api/orders
 * ======================================================
 *
 * Create order
 */
export const createOrder = async (c) => {
  try {
    const body =
      await c.req
        .json()
        .catch(() => ({}));

    const {
      customer,
      items,
      notes,
      checkout_id
    } = body;


    /**
     * ==================================================
     * 1. VALIDATE CHECKOUT ID
     * ==================================================
     */
    if (!checkout_id) {
      return errorResponse(
        c,
        'Checkout ID is required',
        'checkout_id is required',
        400
      );
    }


    /**
     * ==================================================
     * 2. VALIDATE CUSTOMER
     * ==================================================
     */
    if (
      !customer ||
      !customer.name ||
      (
        !customer.email &&
        !customer.phone
      )
    ) {
      return errorResponse(
        c,
        'Invalid customer information',
        'Customer name and at least email or phone are required',
        400
      );
    }


    /**
     * ==================================================
     * 3. VALIDATE ITEMS
     * ==================================================
     */
    if (
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return errorResponse(
        c,
        'Invalid items',
        'Order must contain at least one product item',
        400
      );
    }


    /**
     * ==================================================
     * 4. SUPABASE
     * ==================================================
     */
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


    /**
     * ==================================================
     * 5. CHECK DUPLICATE CHECKOUT
     * ==================================================
     */
    const {
      data: existingOrder,
      error: existingOrderError
    } = await supabase
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


    /**
     * ==================================================
     * 6. NORMALIZE PRODUCT IDs
     * ==================================================
     */
    const productIds =
      Array.from(
        new Set(
          items
            .map((item) => {
              return normalizeProductId(
                item.product_id ||
                item.id
              );
            })
            .filter(Boolean)
        )
      );


    /**
     * ==================================================
     * 7. GET PRODUCTS
     * ==================================================
     */
    const dbProducts =
      await getProductsByIds(
        c.env,
        productIds
      );

    const dbProductMap =
      new Map(
        dbProducts.map(
          (product) => [
            String(product.id),
            product
          ]
        )
      );


    /**
     * ==================================================
     * 8. VALIDATE PRODUCT DATA
     * ==================================================
     */
    let calculatedTotalAmount = 0;

    const validatedOrderItems = [];

    for (const item of items) {

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


      // Product ID required
      if (!pid) {
        return errorResponse(
          c,
          'Invalid product',
          'Product ID is required',
          400
        );
      }


      // Quantity validation
      if (
        Number.isNaN(quantity) ||
        quantity <= 0
      ) {
        return errorResponse(
          c,
          'Invalid quantity',
          `Invalid quantity for product ${pid}`,
          400
        );
      }


      // Maximum order quantity
      if (quantity > 100) {
        return errorResponse(
          c,
          'Invalid quantity',
          'Maximum quantity is 100',
          400
        );
      }


      /**
       * Product harus benar-benar ada.
       * Tidak pakai fallback produk random.
       */
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


      // Product inactive
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


      /**
       * STOCK VALIDATION
       */
      const stock =
        Number(
          dbProduct.stock
        );

      if (
        Number.isFinite(stock) &&
        quantity > stock
      ) {
        return errorResponse(
          c,
          'Maaf, stok menu ini sedang habis.',
          `Only ${stock} unit(s) available for ${dbProduct.name}`,
          400
        );
      }


      /**
       * PRICE
       *
       * Harga selalu dari backend/database.
       * Jangan percaya harga frontend.
       */
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


    /**
     * ==================================================
     * 9. GENERATE ORDER NUMBER
     * ==================================================
     */
    const orderNumber =
      `ARC-${Date.now()}-${Math.floor(
        1000 +
        Math.random() * 9000
      )}`;


    /**
     * ==================================================
     * 10. SAVE CUSTOMER
     * ==================================================
     *
     * Customer history gagal tidak membuat
     * order utama gagal.
     */
    const {
      error: customerError
    } = await supabase
      .from('customers')
      .insert({
        name:
          customer.name,

        email:
          customer.email ||
          null,

        phone:
          customer.phone ||
          null
      });

    if (customerError) {
      console.warn(
        'Customer insert warning:',
        customerError
      );
    }


    /**
     * ==================================================
     * 11. CREATE ORDER
     * ==================================================
     */
    const {
      data: orderData,
      error: orderError
    } = await supabase
      .from('orders')
      .insert({
        checkout_id,

        order_number:
          orderNumber,

        customer_name:
          customer.name,

        customer_email:
          customer.email ||
          null,

        customer_phone:
          customer.phone ||
          null,

        total_amount:
          calculatedTotalAmount,

        status:
          'pending',

        notes:
          notes ||
          null,

        stock_processed:
          false,

        stock_restored:
          false
      })
      .select()
      .single();


    /**
     * ==================================================
     * ORDER INSERT FAILED
     * ==================================================
     */
    if (orderError) {
      console.error(
        'ORDER INSERT FAILED:',
        orderError
      );


      /**
       * Kemungkinan request yang sama
       * masuk bersamaan.
       */
      const {
        data: duplicateOrder
      } = await supabase
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


      /**
       * PENTING:
       *
       * Kalau Supabase gagal,
       * jangan bikin transaksi Midtrans.
       */
      return errorResponse(
        c,
        'Failed to create order',
        orderError.message,
        500
      );
    }


    /**
     * ==================================================
     * 12. CREATE ORDER ITEMS
     * ==================================================
     */
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
    } = await supabase
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


    /**
     * ==================================================
     * 13. CREATE MIDTRANS
     * ==================================================
     *
     * Midtrans hanya dibuat setelah:
     *
     * orders berhasil
     * +
     * order_items berhasil
     */
    let paymentResult;

    try {

      paymentResult =
        await createSnapTransaction(
          c.env,
          {
            orderNumber,

            grossAmount:
              calculatedTotalAmount,

            customer,

            items:
              validatedOrderItems
          }
        );

    } catch (paymentError) {

      console.error(
        'MIDTRANS CREATE FAILED:',
        paymentError
      );


      await supabase
        .from('orders')
        .update({
          status:
            'payment_error'
        })
        .eq(
          'id',
          orderData.id
        );


      return errorResponse(
        c,
        'Order saved but payment failed',
        paymentError?.message ||
        paymentError,
        502
      );
    }


    /**
     * ==================================================
     * 14. SAVE SNAP TOKEN
     * ==================================================
     */
    if (
      paymentResult?.token
    ) {

      const {
        error: snapUpdateError
      } = await supabase
        .from('orders')
        .update({
          snap_token:
            paymentResult.token,

          payment_url:
            paymentResult.redirect_url
        })
        .eq(
          'id',
          orderData.id
        );


      if (snapUpdateError) {
        console.error(
          'SNAP TOKEN SAVE ERROR:',
          snapUpdateError
        );
      }
    }


    /**
     * ==================================================
     * 15. FINAL RESPONSE
     * ==================================================
     */
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
          customer.name,

        email:
          customer.email ||
          null,

        phone:
          customer.phone ||
          null
      },

      items:
        validatedOrderItems,

      notes:
        notes ||
        null,

      payment:
        paymentResult,

      created_at:
        orderData.created_at ||
        new Date().toISOString()
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


/**
 * ======================================================
 * GET /api/orders/:orderNumber
 * ======================================================
 */
export const getOrderByNumber = async (c) => {

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
      } = await supabase
        .from('orders')
        .select('*')
        .eq(
          'order_number',
          orderNumber
        )
        .single();


      if (
        !orderError &&
        order
      ) {

        const {
          data: items
        } = await supabase
          .from('order_items')
          .select('*')
          .eq(
            'order_number',
            orderNumber
          );


        const {
          data: payments
        } = await supabase
          .from('payments')
          .select('*')
          .eq(
            'order_number',
            orderNumber
          )
          .order(
            'created_at',
            {
              ascending: false
            }
          );


        return successResponse(
          c,
          {
            ...order,

            items:
              items || [],

            payments:
              payments || []
          },
          'Order details retrieved successfully'
        );
      }
    }


    /**
     * Runtime fallback
     */
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


/**
 * ======================================================
 * UPDATE ORDER STATUS
 * ======================================================
 */
export const updateOrderStatus = async (
  env,
  orderNumber,
  newStatus,
  paymentDetails = {}
) => {

  const supabase =
    getSupabaseClient(
      env
    );


  /**
   * Runtime cache update
   */
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
          new Date().toISOString()
      }
    );
  }


  /**
   * Supabase update
   */
  if (supabase) {

    const {
      error
    } = await supabase
      .from('orders')
      .update({
        status:
          newStatus,

        updated_at:
          new Date().toISOString()
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


/**
 * ======================================================
 * STOCK MANAGEMENT
 * ======================================================
 *
 * mode:
 *
 * decrease = payment successful
 * increase = refund
 */
export const adjustStockForOrder = async (
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


  /**
   * ==================================================
   * FIND ORDER
   * ==================================================
   */
  const {
    data: order,
    error: orderError
  } = await supabase
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
    .single();


  if (
    orderError ||
    !order
  ) {

    throw new Error(
      `Order '${orderNumber}' not found`
    );
  }


  /**
   * ==================================================
   * PREVENT DOUBLE STOCK DEDUCTION
   * ==================================================
   */
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


  /**
   * ==================================================
   * PREVENT DOUBLE STOCK RESTORE
   * ==================================================
   */
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


  /**
   * ==================================================
   * GET ORDER ITEMS
   * ==================================================
   */
  const {
    data: items,
    error: itemsError
  } = await supabase
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


  /**
   * ==================================================
   * UPDATE PRODUCT STOCK
   * ==================================================
   */
  for (
    const item of
    items || []
  ) {

    const productId =
      normalizeProductId(
        item.product_id
      );


    const {
      data: product,
      error: productError
    } = await supabase
      .from('products')
      .select(
        'id, stock'
      )
      .eq(
        'id',
        productId
      )
      .single();


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
      !Number.isFinite(qty) ||
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


    /**
     * DECREASE
     */
    if (
      mode ===
      'decrease'
    ) {

      if (
        currentStock <
        qty
      ) {

        throw new Error(
          `Maaf, stok menu ini sedang habis. for '${productId}'. Available ${currentStock}, requested ${qty}`
        );
      }


      newStock =
        currentStock -
        qty;

    }


    /**
     * INCREASE
     */
    else {

      newStock =
        currentStock +
        qty;
    }


    /**
     * UPDATE PRODUCT
     */
    const {
      error: updateStockError
    } = await supabase
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


  /**
   * ==================================================
   * MARK STOCK AS PROCESSED
   * ==================================================
   */
  if (
    mode ===
    'decrease'
  ) {

    const {
      error
    } = await supabase
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


  /**
   * ==================================================
   * MARK STOCK AS RESTORED
   * ==================================================
   */
  if (
    mode ===
    'increase'
  ) {

    const {
      error
    } = await supabase
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
      false
  };
};
