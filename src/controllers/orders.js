import { getSupabaseClient } from '../config/supabase.js';
import { getProductsByIds } from './products.js';
import { createSnapTransaction } from '../config/payment.js';
import { successResponse, errorResponse } from '../utils/response.js';

const inMemoryOrdersMap = new Map();

/**
 * Ambil response order existing
 */
const getExistingOrderResponse = async (supabase, order) => {
  const { data: items } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_number', order.order_number);

  return {
    checkout_id: order.checkout_id,
    order_number: order.order_number,
    total_amount: order.total_amount,
    status: order.status,

    customer: {
      name: order.customer_name,
      email: order.customer_email,
      phone: order.customer_phone
    },

    items: items || [],

    notes: order.notes || null,

    payment: order.snap_token
      ? {
          token: order.snap_token,
          redirect_url: order.payment_url
        }
      : null,

    created_at: order.created_at,
    idempotent: true
  };
};


/**
 * POST /api/orders
 */
export const createOrder = async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    const {
      customer,
      items,
      notes,
      checkout_id
    } = body;

    // ================================
    // VALIDASI CHECKOUT ID
    // ================================

    if (!checkout_id) {
      return errorResponse(
        c,
        'Checkout ID is required',
        'checkout_id is required',
        400
      );
    }

    // ================================
    // VALIDASI CUSTOMER
    // ================================

    if (
      !customer ||
      !customer.name ||
      (!customer.email && !customer.phone)
    ) {
      return errorResponse(
        c,
        'Invalid customer information',
        'Customer name and at least email or phone are required',
        400
      );
    }

    // ================================
    // VALIDASI ITEMS
    // ================================

    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse(
        c,
        'Invalid items',
        'Order must contain at least one product item',
        400
      );
    }

    const supabase = getSupabaseClient(c.env);

    if (!supabase) {
      return errorResponse(
        c,
        'Database unavailable',
        'Supabase connection unavailable',
        503
      );
    }

    // ================================
    // CEK DUPLICATE CHECKOUT
    // ================================

    const {
      data: existingOrder,
      error: existingOrderError
    } = await supabase
      .from('orders')
      .select('*')
      .eq('checkout_id', checkout_id)
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

    // ================================
    // AMBIL PRODUK DATABASE
    // ================================

    const productIds = Array.from(
      new Set(
        items
          .map(item =>
            String(
              item.product_id ||
              item.id ||
              ''
            )
          )
          .filter(Boolean)
      )
    );

    const dbProducts =
      await getProductsByIds(
        c.env,
        productIds
      );

    const dbProductMap =
      new Map(
        dbProducts.map(product => [
          String(product.id),
          product
        ])
      );

    let calculatedTotalAmount = 0;

    const validatedOrderItems = [];

    // ================================
    // VALIDASI PRODUK
    // ================================

    for (const item of items) {
      const pid = String(
        item.product_id ||
        item.id ||
        ''
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

      if (quantity > 100) {
        return errorResponse(
          c,
          'Invalid quantity',
          'Maximum quantity is 100',
          400
        );
      }

      const dbProduct =
        dbProductMap.get(pid);

      // Tidak ada fallback produk palsu
      if (!dbProduct) {
        return errorResponse(
          c,
          'Product not found',
          `Product '${pid}' does not exist`,
          400
        );
      }

      if (
        dbProduct.is_active === false
      ) {
        return errorResponse(
          c,
          'Product unavailable',
          `${dbProduct.name} is unavailable`,
          400
        );
      }

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
          'Insufficient stock',
          `Only ${stock} unit(s) available for ${dbProduct.name}`,
          400
        );
      }

      const unitPrice =
        Number(
          dbProduct.price
        );

      if (
        !Number.isFinite(unitPrice) ||
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
        unitPrice * quantity;

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

    // ================================
    // GENERATE ORDER NUMBER
    // ================================

    const orderNumber =
      `ARC-${Date.now()}-${Math.floor(
        1000 +
        Math.random() * 9000
      )}`;

    // ================================
    // CUSTOMER HISTORY
    // ================================

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

    // ================================
    // CREATE ORDER
    // ================================

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

    if (orderError) {
      console.error(
        'ORDER INSERT FAILED:',
        orderError
      );

      // Mungkin request duplicate masuk bersamaan
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

      // PENTING:
      // Jangan lanjut Midtrans kalau database gagal
      return errorResponse(
        c,
        'Failed to create order',
        orderError.message,
        500
      );
    }

    // ================================
    // CREATE ORDER ITEMS
    // ================================

    const orderItemsPayload =
      validatedOrderItems.map(
        item => ({
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

    // ================================
    // BARU CREATE MIDTRANS
    // ================================

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

    // ================================
    // SAVE SNAP TOKEN
    // ================================

    if (paymentResult?.token) {
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

    // ================================
    // RESPONSE
    // ================================

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
 * GET /api/orders/:orderNumber
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
              items ||
              [],
            payments:
              payments ||
              []
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


/**
 * Update order status
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
    }
  }
};


/**
 * Kurangi / kembalikan stok
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

  // Sudah pernah dipotong
  if (
    mode === 'decrease' &&
    order.stock_processed
  ) {
    return {
      success: true,
      skipped: true,
      reason:
        'Stock already deducted'
    };
  }

  // Sudah pernah dikembalikan
  if (
    mode === 'increase' &&
    order.stock_restored
  ) {
    return {
      success: true,
      skipped: true,
      reason:
        'Stock already restored'
    };
  }

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

  for (const item of items || []) {
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
        String(
          item.product_id
        )
      )
      .single();

    if (
      productError ||
      !product
    ) {
      throw new Error(
        `Product '${item.product_id}' not found`
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

    let newStock;

    if (
      mode ===
      'decrease'
    ) {
      if (
        currentStock <
        qty
      ) {
        throw new Error(
          `Insufficient stock for '${item.product_id}'`
        );
      }

      newStock =
        currentStock -
        qty;

    } else {
      newStock =
        currentStock +
        qty;
    }

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
        String(
          item.product_id
        )
      );

    if (updateStockError) {
      throw updateStockError;
    }
  }

  if (
    mode ===
    'decrease'
  ) {
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
  }

  if (
    mode ===
    'increase'
  ) {
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
  }

  return {
    success: true,
    skipped: false
  };
};
