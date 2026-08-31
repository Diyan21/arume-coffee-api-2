import {
  getSupabaseClient
} from '../config/supabase.js';

import {
  createXenditPaymentSession,
  getXenditPaymentSession,
  verifyXenditWebhook
} from '../config/payment.js';

import {
  updateOrderStatus,
  adjustStockForOrder
} from './orders.js';

import {
  successResponse,
  errorResponse
} from '../utils/response.js';


/*
 * Runtime cache.
 *
 * Ini cuma lapisan tambahan.
 * Idempotency utama tetap database.
 */
const processedCallbackMap =
  new Map();


/* =========================================================
   CREATE PAYMENT
   POST /api/payment/create
   ========================================================= */

export const createPayment =
async (c) => {

  try {

    const body =
      await c.req
        .json()
        .catch(() => ({}));


    const {
      order_number
    } = body;


    if (!order_number) {
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


    if (!supabase) {
      return errorResponse(
        c,
        'Database is not configured',
        null,
        500
      );
    }


    /* -----------------------------------------------------
       GET ORDER
       ----------------------------------------------------- */

    const {
      data: orderRecord,
      error: orderError
    } =
      await supabase
        .from('orders')
        .select('*')
        .eq(
          'order_number',
          order_number
        )
        .single();


    if (orderError) {
      console.error(
        'Failed to find order:',
        orderError
      );
    }


    if (!orderRecord) {
      return errorResponse(
        c,
        'Order not found',
        `Order number '${order_number}' does not exist`,
        404
      );
    }


    /* -----------------------------------------------------
       ALREADY PAID
       ----------------------------------------------------- */

    if (
      orderRecord.status === 'paid' ||
      orderRecord.status === 'settled'
    ) {
      return errorResponse(
        c,
        'Order already paid',
        `Order '${order_number}' is already paid`,
        400
      );
    }


    /*
     * Kalau order pending dan masih punya
     * Xendit payment URL,
     * gunakan link existing.
     *
     * payment_id kita gunakan untuk
     * menyimpan payment_session_id.
     */
    if (
      orderRecord.status ===
        'pending' &&

      orderRecord.payment_provider ===
        'xendit' &&

      orderRecord.payment_id &&

      orderRecord.payment_url
    ) {

      return successResponse(
        c,
        {
          order_number,

          payment: {
            provider:
              'xendit',

            session_id:
              orderRecord.payment_id,

            redirect_url:
              orderRecord.payment_url,

            payment_link_url:
              orderRecord.payment_url,

            reused:
              true
          }
        },
        'Existing Xendit payment session returned'
      );
    }


    /* -----------------------------------------------------
       LOAD ORDER ITEMS
       ----------------------------------------------------- */

    const {
      data: orderItems,
      error: itemsError
    } =
      await supabase
        .from('order_items')
        .select('*')
        .eq(
          'order_id',
          orderRecord.id
        );


    if (itemsError) {
      console.error(
        'Failed loading order items:',
        itemsError
      );
    }


    /* -----------------------------------------------------
       CREATE XENDIT SESSION
       ----------------------------------------------------- */

    const paymentResult =
      await createXenditPaymentSession(
        c.env,
        {
          orderNumber:
            orderRecord.order_number,

          grossAmount:
            orderRecord.total_amount,

          customer: {
            name:
              orderRecord.customer_name,

            email:
              orderRecord.customer_email,

            phone:
              orderRecord.customer_phone
          },

          items:
            orderItems || []
        }
      );


    /* -----------------------------------------------------
       SAVE PAYMENT SESSION
       ----------------------------------------------------- */

    const {
      error: updateError
    } =
      await supabase
        .from('orders')
        .update({
          payment_provider:
            'xendit',

          payment_id:
            paymentResult
              .session_id,

          payment_url:
            paymentResult
              .redirect_url,

          payment_method:
            null,

          /*
           * Midtrans field lama.
           *
           * Jangan dipakai untuk Xendit.
           */
          snap_token:
            null
        })
        .eq(
          'id',
          orderRecord.id
        );


    if (updateError) {
      console.error(
        'Failed saving Xendit payment session:',
        updateError
      );
    }


    return successResponse(
      c,
      {
        order_number,

        payment:
          paymentResult
      },
      'Xendit payment session created successfully'
    );


  } catch (err) {

    console.error(
      'Create Payment Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to create payment transaction',
      err.message || err,
      500
    );
  }
};


/* =========================================================
   XENDIT WEBHOOK
   POST /api/payment/callback
   ========================================================= */

export const handlePaymentCallback =
async (c) => {

  try {

    /* -----------------------------------------------------
       1. VERIFY CALLBACK TOKEN
       ----------------------------------------------------- */

    const callbackToken =
      c.req.header(
        'x-callback-token'
      );


    const isValid =
      verifyXenditWebhook(
        c.env,
        callbackToken
      );


    if (!isValid) {
      return errorResponse(
        c,
        'Invalid Xendit webhook token',
        'Webhook verification failed',
        403
      );
    }


    const body =
      await c.req
        .json()
        .catch(() => ({}));


    console.log(
      'Xendit Webhook:',
      JSON.stringify(body)
    );


    const event =
      body.event ||
      'unknown';


    const data =
      body.data ||
      {};


    /* -----------------------------------------------------
       2. ORDER REFERENCE
       ----------------------------------------------------- */

    /*
     * Session reference_id kita buat:
     *
     * ORDERNUMBER-timestamp
     *
     * metadata.order_number lebih aman
     * kalau tersedia.
     */

    let orderNumber =
      data?.metadata
        ?.order_number ||
      body?.metadata
        ?.order_number ||
      null;


    /*
     * Fallback:
     * cari berdasarkan payment_session_id.
     */
    const paymentSessionId =
      data.payment_session_id ||
      body.payment_session_id ||
      null;


    const paymentId =
      data.payment_id ||
      data.payment_request_id ||
      paymentSessionId ||
      null;


    const supabase =
      getSupabaseClient(
        c.env
      );


    if (!supabase) {
      return errorResponse(
        c,
        'Database is not configured',
        null,
        500
      );
    }


    /*
     * Kalau metadata order_number tidak
     * dikirim webhook, cari order berdasarkan
     * payment_session_id yang kita simpan
     * dalam orders.payment_id.
     */
    let orderRecord =
      null;


    if (paymentSessionId) {

      const {
        data: foundOrder,
        error: lookupError
      } =
        await supabase
          .from('orders')
          .select('*')
          .eq(
            'payment_id',
            paymentSessionId
          )
          .maybeSingle();


      if (lookupError) {
        console.error(
          'Order lookup by payment session:',
          lookupError
        );
      }


      if (foundOrder) {
        orderRecord =
          foundOrder;

        orderNumber =
          foundOrder
            .order_number;
      }
    }


    /*
     * Fallback kedua:
     * reference_id.
     */
    if (
      !orderNumber &&
      data.reference_id
    ) {

      const referenceId =
        String(
          data.reference_id
        );


      /*
       * Contoh:
       * ORD-123-1720000000000
       *
       * Cari order yang payment_id-nya
       * sama jauh lebih ideal.
       *
       * Jadi ini hanya fallback.
       */

      console.log(
        'Xendit reference_id:',
        referenceId
      );
    }


    if (!orderNumber) {

      console.error(
        'Unable to identify order from Xendit webhook:',
        body
      );


      return errorResponse(
        c,
        'Order could not be identified',
        null,
        400
      );
    }


    if (!orderRecord) {

      const {
        data: foundOrder,
        error: lookupError
      } =
        await supabase
          .from('orders')
          .select('*')
          .eq(
            'order_number',
            orderNumber
          )
          .maybeSingle();


      if (lookupError) {
        console.error(
          'Order lookup error:',
          lookupError
        );
      }


      orderRecord =
        foundOrder;
    }


    if (!orderRecord) {
      return errorResponse(
        c,
        'Order not found',
        `Order '${orderNumber}' does not exist`,
        404
      );
    }


    /* -----------------------------------------------------
       3. IDEMPOTENCY
       ----------------------------------------------------- */

    const transactionId =
      paymentId ||
      paymentSessionId ||
      `${event}-${orderNumber}`;


    const idempotencyKey =
      `${transactionId}:${event}`;


    if (
      processedCallbackMap.has(
        idempotencyKey
      )
    ) {

      return successResponse(
        c,
        {
          order_number:
            orderNumber,

          transaction_id:
            transactionId,

          event,

          idempotent:
            true
        },
        'Webhook already processed'
      );
    }


    /* -----------------------------------------------------
       4. DATABASE IDEMPOTENCY
       ----------------------------------------------------- */

    const {
      data: existingPayment,
      error: existingPaymentError
    } =
      await supabase
        .from('payments')
        .select(
          'id, transaction_id, transaction_status'
        )
        .eq(
          'transaction_id',
          transactionId
        )
        .eq(
          'transaction_status',
          event
        )
        .maybeSingle();


    if (existingPaymentError) {
      console.error(
        'Payment history lookup:',
        existingPaymentError
      );
    }


    if (existingPayment) {

      processedCallbackMap.set(
        idempotencyKey,
        true
      );


      return successResponse(
        c,
        {
          order_number:
            orderNumber,

          transaction_id:
            transactionId,

          event,

          idempotent:
            true
        },
        'Xendit webhook already recorded'
      );
    }


    /* -----------------------------------------------------
       5. MAP XENDIT EVENT
       ----------------------------------------------------- */

    let newOrderStatus =
      orderRecord.status ||
      'pending';


    if (
      event ===
      'payment_session.completed'
    ) {
      newOrderStatus =
        'paid';
    }


    else if (
      event ===
      'payment_session.expired'
    ) {
      newOrderStatus =
        'failed';
    }


    else if (
      event ===
        'payment.succeeded' ||
      event ===
        'payment.capture'
    ) {
      newOrderStatus =
        'paid';
    }


    else if (
      event ===
        'payment.failed'
    ) {
      newOrderStatus =
        'failed';
    }


    else if (
      event ===
        'payment.refund' ||
      event ===
        'refund.succeeded'
    ) {
      newOrderStatus =
        'refunded';
    }


    /* -----------------------------------------------------
       PAYMENT METHOD
       ----------------------------------------------------- */

    const paymentMethod =
      data.payment_method
        ?.type ||

      data.payment_method
        ?.channel_code ||

      data.channel_code ||

      data.payment_channel ||

      data.payment_method ||

      null;


    const grossAmount =
      Number(
        data.amount ||
        body.amount ||
        orderRecord.total_amount ||
        0
      );


    /* -----------------------------------------------------
       6. UPDATE ORDER
       ----------------------------------------------------- */

    await updateOrderStatus(
      c.env,
      orderNumber,
      newOrderStatus,
      {
        transaction_id:
          transactionId,

        payment_type:
          paymentMethod ||
          'xendit',

        transaction_status:
          event
      }
    );


    /*
     * Update kolom Xendit tambahan
     */
    const orderUpdate = {
      payment_provider:
        'xendit',

      payment_id:
        paymentSessionId ||
        orderRecord.payment_id,

      payment_method:
        paymentMethod
          ? String(paymentMethod)
          : orderRecord.payment_method
    };


    if (
      newOrderStatus ===
      'paid'
    ) {
      orderUpdate.paid_at =
        new Date().toISOString();
    }


    const {
      error: paymentUpdateError
    } =
      await supabase
        .from('orders')
        .update(
          orderUpdate
        )
        .eq(
          'id',
          orderRecord.id
        );


    if (paymentUpdateError) {
      console.error(
        'Xendit order payment update failed:',
        paymentUpdateError
      );
    }


    /* -----------------------------------------------------
       7. STOCK MANAGEMENT
       ----------------------------------------------------- */

    if (
      newOrderStatus ===
      'paid'
    ) {

      try {

        const stockResult =
          await adjustStockForOrder(
            c.env,
            orderNumber,
            'decrease'
          );


        console.log(
          'Stock deduction result:',
          stockResult
        );

      } catch (
        stockError
      ) {

        console.error(
          'Stock deduction failed:',
          stockError
        );

      }
    }


    if (
      newOrderStatus ===
      'refunded'
    ) {

      try {

        const stockResult =
          await adjustStockForOrder(
            c.env,
            orderNumber,
            'increase'
          );


        console.log(
          'Stock restoration result:',
          stockResult
        );

      } catch (
        stockError
      ) {

        console.error(
          'Stock restoration failed:',
          stockError
        );

      }
    }


    /* -----------------------------------------------------
       8. STORE PAYMENT HISTORY
       ----------------------------------------------------- */

    const {
      error: paymentInsertError
    } =
      await supabase
        .from('payments')
        .insert({

          order_number:
            orderNumber,

          transaction_id:
            transactionId,

          payment_type:
            paymentMethod
              ? String(paymentMethod)
              : 'xendit',

          gross_amount:
            grossAmount,

          transaction_status:
            event,

          /*
           * Field warisan Midtrans.
           * Xendit tidak membutuhkan ini.
           */
          fraud_status:
            null,

          payment_provider:
            'xendit',

          transaction_time:
            body.created ||
            data.created ||
            new Date()
              .toISOString(),

          settlement_time:
            newOrderStatus ===
              'paid'
              ? new Date()
                  .toISOString()
              : null,

          raw_response:
            body
        });


    if (paymentInsertError) {
      console.error(
        'Payment history insert error:',
        paymentInsertError
      );
    }


    /* -----------------------------------------------------
       9. MARK PROCESSED
       ----------------------------------------------------- */

    processedCallbackMap.set(
      idempotencyKey,
      true
    );


    /* -----------------------------------------------------
       10. RESPONSE XENDIT
       ----------------------------------------------------- */

    return successResponse(
      c,
      {
        order_number:
          orderNumber,

        order_status:
          newOrderStatus,

        transaction_id:
          transactionId,

        event,

        provider:
          'xendit'
      },
      'Xendit webhook processed successfully'
    );


  } catch (err) {

    console.error(
      'Xendit Callback Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to process Xendit webhook',
      err.message || err,
      500
    );

  }
};


/* =========================================================
   CHECK PAYMENT STATUS
   POST /api/payment/check
   ========================================================= */

export const checkPaymentStatus =
async (c) => {

  try {

    const body =
      await c.req
        .json()
        .catch(() => ({}));


    const {
      order_number
    } = body;


    if (!order_number) {
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


    if (!supabase) {
      return errorResponse(
        c,
        'Database is not configured',
        null,
        500
      );
    }


    /* -----------------------------------------------------
       GET ORDER
       ----------------------------------------------------- */

    const {
      data: order,
      error: orderError
    } =
      await supabase
        .from('orders')
        .select(`
          order_number,
          total_amount,
          status,
          payment_provider,
          payment_id,
          payment_method,
          payment_url,
          paid_at,
          stock_processed,
          stock_restored,
          created_at,
          updated_at
        `)
        .eq(
          'order_number',
          order_number
        )
        .single();


    if (orderError) {
      console.error(
        'Order status lookup error:',
        orderError
      );
    }


    if (!order) {
      return errorResponse(
        c,
        'Order not found',
        `Order '${order_number}' does not exist`,
        404
      );
    }


    /* -----------------------------------------------------
       XENDIT SERVER CHECK
       ----------------------------------------------------- */

    let xenditSession =
      null;


    if (
      order.payment_provider ===
        'xendit' &&
      order.payment_id
    ) {

      try {

        xenditSession =
          await getXenditPaymentSession(
            c.env,
            order.payment_id
          );

      } catch (
        sessionError
      ) {

        console.error(
          'Xendit session lookup failed:',
          sessionError
        );

      }
    }


    /* -----------------------------------------------------
       PAYMENT HISTORY
       ----------------------------------------------------- */

    const {
      data: payments,
      error: paymentsError
    } =
      await supabase
        .from('payments')
        .select('*')
        .eq(
          'order_number',
          order_number
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
        order_number:
          order.order_number,

        order_status:
          order.status,

        total_amount:
          order.total_amount,

        payment_provider:
          order.payment_provider,

        payment_method:
          order.payment_method,

        payment_url:
          order.payment_url,

        paid_at:
          order.paid_at,

        stock_processed:
          order.stock_processed,

        stock_restored:
          order.stock_restored,

        xendit_session:
          xenditSession,

        payments:
          payments || []
      },
      'Payment status checked successfully'
    );


  } catch (err) {

    console.error(
      'Check Payment Status Error:',
      err
    );


    return errorResponse(
      c,
      'Failed to check payment status',
      err.message || err,
      500
    );
  }
};
