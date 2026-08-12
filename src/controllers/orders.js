import { getSupabaseClient } from '../config/supabase.js';
import { getProductsByIds } from './products.js';
import { createSnapTransaction } from '../config/payment.js';
import { successResponse, errorResponse } from '../utils/response.js';

const inMemoryOrdersMap = new Map();

export const createOrder = async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { customer, items, notes } = body;

    if (!customer || !customer.name || (!customer.email && !customer.phone)) {
      return errorResponse(c, 'Invalid customer information', 'Customer name and at least email or phone are required', 400);
    }

    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse(c, 'Invalid items', 'Order must contain at least one product item', 400);
    }

    const productIds = Array.from(new Set(items.map(i => i.product_id || i.id).filter(Boolean)));
    if (productIds.length === 0) {
      return errorResponse(c, 'Invalid product IDs', 'Product IDs missing in items payload', 400);
    }

    const dbProducts = await getProductsByIds(c.env, productIds);
    const dbProductMap = new Map(dbProducts.map(p => [p.id, p]));

    let calculatedTotalAmount = 0;
    const validatedOrderItems = [];

    for (const item of items) {
      const pid = item.product_id || item.id;
      const quantity = parseInt(item.quantity, 10);

      if (!pid || isNaN(quantity) || quantity <= 0) {
        return errorResponse(c, 'Invalid item quantity', `Quantity for product ${pid} must be greater than 0`, 400);
      }

      const dbProduct = dbProductMap.get(pid);
      if (!dbProduct) {
        return errorResponse(c, 'Product not found', `Product ID '${pid}' does not exist or is inactive`, 400);
      }

      if (!dbProduct.is_active) {
        return errorResponse(c, 'Product unavailable', `Product '${dbProduct.name}' is currently unavailable`, 400);
      }

      if (typeof dbProduct.stock === 'number' && dbProduct.stock < quantity) {
        return errorResponse(c, 'Insufficient stock', `Insufficient stock for '${dbProduct.name}'. Available: ${dbProduct.stock}`, 400);
      }

      const unitPrice = parseFloat(dbProduct.price);
      const subtotal = unitPrice * quantity;
      calculatedTotalAmount += subtotal;

      validatedOrderItems.push({
        product_id: dbProduct.id,
        product_name: dbProduct.name,
        price: unitPrice,
        quantity: quantity,
        subtotal: subtotal
      });
    }

    const orderNumber = `ARC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const supabase = getSupabaseClient(c.env);

    let createdOrderRecord = null;

    if (supabase) {
      try {
        await supabase
          .from('customers')
          .insert({
            name: customer.name,
            email: customer.email || null,
            phone: customer.phone || null
          });
      } catch (custErr) {
        console.warn('Customer record insert warning:', custErr);
      }

      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .insert({
          order_number: orderNumber,
          customer_name: customer.name,
          customer_email: customer.email || null,
          customer_phone: customer.phone || null,
          total_amount: calculatedTotalAmount,
          status: 'pending',
          notes: notes || null
        })
        .select()
        .single();

      if (!orderErr && orderData) {
        createdOrderRecord = orderData;

        const orderItemsPayload = validatedOrderItems.map(item => ({
          order_id: orderData.id,
          order_number: orderNumber,
          product_id: item.product_id,
          product_name: item.product_name,
          price: item.price,
          quantity: item.quantity,
          subtotal: item.subtotal
        }));

        const { error: orderItemsError } = await supabase
          .from('order_items')
          .insert(orderItemsPayload);

        if (orderItemsError) {
          console.error('Order items insert error:', orderItemsError);
        }
      } else {
        console.error('Supabase order insert error:', orderErr);
      }
    }

    const paymentResult = await createSnapTransaction(c.env, {
      orderNumber,
      grossAmount: calculatedTotalAmount,
      customer,
      items: validatedOrderItems
    });

    if (supabase && createdOrderRecord) {
      await supabase
        .from('orders')
        .update({
          snap_token: paymentResult.token,
          payment_url: paymentResult.redirect_url
        })
        .eq('id', createdOrderRecord.id);
    }

    const finalOrderResponse = {
      order_number: orderNumber,
      total_amount: calculatedTotalAmount,
      status: 'pending',
      customer: {
        name: customer.name,
        email: customer.email || null,
        phone: customer.phone || null
      },
      items: validatedOrderItems,
      notes: notes || null,
      payment: paymentResult,
      created_at: new Date().toISOString()
    };

    inMemoryOrdersMap.set(orderNumber, finalOrderResponse);

    return successResponse(c, finalOrderResponse, 'Order created successfully', 201);
  } catch (err) {
    return errorResponse(c, 'Failed to create order', err.message || err, 500);
  }
};

export const getOrderByNumber = async (c) => {
  try {
    const orderNumber = c.req.param('orderNumber');
    if (!orderNumber) {
      return errorResponse(c, 'Order number is required', null, 400);
    }

    const supabase = getSupabaseClient(c.env);

    if (supabase) {
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', orderNumber)
        .single();

      if (!orderErr && order) {
        const { data: items } = await supabase
          .from('order_items')
          .select('*')
          .eq('order_number', orderNumber);

        const { data: payments } = await supabase
          .from('payments')
          .select('*')
          .eq('order_number', orderNumber)
          .order('created_at', { ascending: false });

        return successResponse(c, {
          ...order,
          items: items || [],
          payments: payments || []
        }, 'Order details retrieved successfully');
      }
    }

    if (inMemoryOrdersMap.has(orderNumber)) {
      return successResponse(c, inMemoryOrdersMap.get(orderNumber), 'Order details retrieved successfully (Runtime)');
    }

    return errorResponse(c, 'Order not found', `No order found with order number ${orderNumber}`, 404);
  } catch (err) {
    return errorResponse(c, 'Failed to fetch order details', err.message || err, 500);
  }
};

export const updateOrderStatus = async (env, orderNumber, newStatus, paymentDetails = {}) => {
  const supabase = getSupabaseClient(env);

  if (inMemoryOrdersMap.has(orderNumber)) {
    const existing = inMemoryOrdersMap.get(orderNumber);
    inMemoryOrdersMap.set(orderNumber, {
      ...existing,
      status: newStatus,
      payment_details: paymentDetails,
      updated_at: new Date().toISOString()
    });
  }

  if (supabase) {
    await supabase
      .from('orders')
      .update({
        status: newStatus,
        updated_at: new Date().toISOString()
      })
      .eq('order_number', orderNumber);
  }
};
