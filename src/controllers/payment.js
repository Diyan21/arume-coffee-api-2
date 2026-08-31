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


/* =========================================================
   RUNTIME CACHE
   ========================================================= */

/*
 * Cache ini hanya pengaman tambahan.
 * Idempotency utama tetap dicek dari database.
 */
const processedCallbackMap =
  new Map();


/* =========================================================
   HELPERS
   ========================================================= */

const normalizeEvent = (
  event
) => {

  return String(
    event || ''
  )
    .trim()
    .toLowerCase();
};


const getPaymentMethod = (
  data = {}
) => {

  const method =
    data?.payment_method?.type ||
    data?.payment_method?.channel_code ||
    data?.channel_code ||
    data?.payment_channel ||
    null;


  if (!method) {
    return null;
  }


  if (
    typeof method ===
    'string'
  ) {
    return method;
  }


  try {

    return JSON.stringify(
      method
    );

  } catch {

    return 'xendit';
  }
};


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
        .catch(
          () => ({})
        );


    const {
      order_number
    } = body;


    /* -----------------------------------------------------
       VALIDATION
       ----------------------------------------------------- */

    if (!order_number) {

      return errorResponse(
        c,
        'Order number is required',
        null,
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
        .maybeSingle();


    if (orderError) {

      console.error(
        'Order lookup error:',
        orderError
      );


      return errorResponse(
        c,
        'Failed to find order',
        orderError.message,
        500
      );
    }


    if (!orderRecord) {

      return errorResponse(
        c,
        'Order not found',
        `Order '${order_number}' does not exist`,
        404
      );
    }


    /* -----------------------------------------------------
       ORDER ALREADY PAID
       ----------------------------------------------------- */

    if (
      orderRecord.status ===
        'paid' ||
      orderRecord.status ===
        'settled'
    ) {

      return errorResponse(
        c,
        'Order already paid',
        `Order '${order_number}' is already paid`,
        400
      );
    }


    /* -----------------------------------------------------
       REUSE EXISTING PAYMENT SESSION
       ----------------------------------------------------- */

    if (
      orderRecord.status ===
        'pending' &&

      orderRecord
        .payment_provider ===
        'xendit' &&

      orderRecord.payment_id &&

      orderRecord.payment_url
    ) {

      return successResponse(
        c,
        {
          order_number:
            order_number,

          payment: {
            provider:
              'xendit',

            session_id:
              orderRecord
                .payment_id,

            redirect_url:
              orderRecord
                .payment_url,

            payment_link_url:
              orderRecord
                .payment_url,

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
        'Order items lookup error:',
        itemsError
      );
    }


    /* -----------------------------------------------------
       CREATE XENDIT PAYMENT SESSION
       ----------------------------------------------------- */

    const paymentResult =
      await createXenditPaymentSession(
        c.env,
        {
          orderNumber:
            orderRecord
              .order_number,

          grossAmount:
            orderRecord
              .total_amount,

          customer: {
            name:
              orderRecord
                .customer_name,

            email:
              orderRecord
                .customer_email,

            phone:
              orderRecord
                .customer_phone
          },

          /*
           * Config sekarang belum wajib
           * menggunakan items.
           * Tetap kita kirim supaya nanti
           * mudah dikembangkan.
           */
          items:
            orderItems || []
        }
      );


    if (
      !paymentResult ||
      !paymentResult.session_id ||
      !paymentResult.redirect_url
    ) {

      console.error(
        'Invalid Xendit payment response:',
        paymentResult
      );


      return errorResponse(
        c,
        'Invalid response from Xendit',
        paymentResult,
        502
      );
    }


    /* -----------------------------------------------------
       SAVE PAYMENT SESSION TO ORDER
       ----------------------------------------------------- */

    const {
      error: saveError
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
           * Field Midtrans lama.
           * Untuk Xendit dikosongkan.
           */
          snap_token:
            null
        })
        .eq(
          'id',
          orderRecord.id
        );


    if (saveError) {

      console.error(
        'Failed saving Xendit session:',
        saveError
      );


      return errorResponse(
        c,
        'Payment created but failed to save payment session',
        saveError.message,
        500
      );
    }


    /* -----------------------------------------------------
       RESPONSE
       ----------------------------------------------------- */

    return successResponse(
      c,
      {
        order_number:
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
      err?.message || err,
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
       1. VERIFY XENDIT TOKEN
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

      console.error(
        'Invalid Xendit webhook token'
      );


      return errorResponse(
        c,
        'Invalid Xendit webhook token',
        'Webhook verification failed',
        403
      );
    }


    /* -----------------------------------------------------
       2. READ WEBHOOK BODY
       ----------------------------------------------------- */

    const body =
      await c.req
        .json()
        .catch(
          () => ({})
        );


    console.log(
      'Xendit Webhook:',
      JSON.stringify(
        body
      )
    );


    const event =
      normalizeEvent(
        body?.event
      );


    const data =
      body?.data ||
      {};


    const paymentSessionId =
      data?.payment_session_id ||
      body?.payment_session_id ||
      null;


    const referenceId =
      data?.reference_id ||
      body?.reference_id ||
      null;


    const paymentId =
      data?.payment_id ||
      data?.payment_request_id ||
      null;


    /* -----------------------------------------------------
       3. XENDIT TEST WEBHOOK
       ----------------------------------------------------- */

    /*
     * Tombol "Tes dan simpan" di dashboard
     * bisa mengirim dummy webhook yang tidak
     * berkaitan dengan order Supabase.
     *
     * Kalau token valid tetapi tidak ada
     * reference transaksi, cukup acknowledge.
     */
    if (
      !paymentSessionId &&
      !referenceId &&
      !paymentId
    ) {

      console.log(
        'Xendit connectivity test webhook received'
      );


      return successResponse(
        c,
        {
          received:
            true,

          event:
            event ||
            'test',

          test_webhook:
            true
        },
        'Xendit webhook endpoint is reachable'
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
        'Database is not configured',
        null,
        500
      );
    }


    /* -----------------------------------------------------
       5. FIND ORDER
       ----------------------------------------------------- */

    let orderRecord =
      null;


    let orderNumber =
      data?.metadata
        ?.order_number ||

      body?.metadata
        ?.order_number ||

      null;


    /* -----------------------------------------------------
       LOOKUP 1:
       PAYMENT SESSION ID
       ----------------------------------------------------- */

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
          'Lookup by payment_session_id error:',
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


    /* -----------------------------------------------------
       LOOKUP 2:
       REFERENCE ID
       ----------------------------------------------------- */

    /*
     * config/payment.js kita membuat:
     *
     * reference_id = order_number
     *
     * Jadi webhook bisa langsung lookup
     * orders.order_number.
     */
    if (
      !orderRecord &&
      referenceId
    ) {

      const normalizedReference =
        String(
          referenceId
        ).trim();


      const {
        data: foundOrder,
        error: lookupError
      } =
        await supabase
          .from('orders')
          .select('*')
          .eq(
            'order_number',
            normalizedReference
          )
          .maybeSingle();


      if (lookupError) {

        console.error(
          'Lookup by reference_id error:',
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


    /* -----------------------------------------------------
       LOOKUP 3:
       METADATA ORDER NUMBER
       ----------------------------------------------------- */

    if (
      !orderRecord &&
      orderNumber
    ) {

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
          'Lookup by metadata order number error:',
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


    /* -----------------------------------------------------
       UNKNOWN / DASHBOARD TEST ORDER
       ----------------------------------------------------- */

    if (!orderRecord) {

      console.warn(
        'Authenticated Xendit webhook does not match an order:',
        {
          event,
          paymentSessionId,
          referenceId
        }
      );


      /*
       * Return 200.
       *
       * Jangan update database karena
       * order tidak ditemukan.
       */
      return successResponse(
        c,
        {
          received:
            true,

          event:
            event ||
            'unknown',

          payment_session_id:
            paymentSessionId,

          reference_id:
            referenceId,

          matched_order:
            false
        },
        'Xendit webhook received'
      );
    }


    orderNumber =
      orderRecord
        .order_number;


    /* -----------------------------------------------------
       6. TRANSACTION ID
       ----------------------------------------------------- */

    const transactionId =
      paymentId ||
      paymentSessionId ||
      `${event}:${orderNumber}`;


    const idempotencyKey =
      `${transactionId}:${event}`;


    /* -----------------------------------------------------
       7. MEMORY IDEMPOTENCY
       ----------------------------------------------------- */

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

          event:
            event,

          idempotent:
            true
        },
        'Webhook already processed'
      );
    }


    /* -----------------------------------------------------
       8. DATABASE IDEMPOTENCY
       ----------------------------------------------------- */

    const {
      data: existingPayment,
      error: existingPaymentError
    } =
      await supabase
        .from('payments')
        .select(`
          id,
          transaction_id,
          transaction_status
        `)
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
        'Payment idempotency lookup error:',
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

          event:
            event,

          idempotent:
            true
        },
        'Xendit webhook already recorded'
      );
    }


    /* -----------------------------------------------------
       9. MAP XENDIT EVENT
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


    /*
     * Tambahan untuk future Payment API
     */
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


    else {

      console.log(
        'Unhandled Xendit event:',
        event
      );


      /*
       * Event valid tetapi bukan event
       * yang mengubah status order.
       */
      return successResponse(
        c,
        {
          received:
            true,

          order_number:
            orderNumber,

          event:
            event,

          order_status:
            orderRecord.status
        },
        'Xendit webhook received but no order status change required'
      );
    }


    /* -----------------------------------------------------
       10. PAYMENT INFORMATION
       ----------------------------------------------------- */

    const paymentMethod =
      getPaymentMethod(
        data
      );


    const grossAmount =
      Number(
        data?.amount ??
        body?.amount ??
        orderRecord
          .total_amount ??
        0
      );


    /* -----------------------------------------------------
       11. UPDATE ORDER STATUS
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


    /* -----------------------------------------------------
       12. UPDATE XENDIT FIELDS
       ----------------------------------------------------- */

    const orderUpdate = {
      payment_provider:
        'xendit',

      payment_id:
        paymentSessionId ||
        orderRecord
          .payment_id,

      payment_method:
        paymentMethod
          ? String(
              paymentMethod
            )
          : orderRecord
              .payment_method
    };


    /*
     * Set paid_at hanya kalau belum ada.
     */
    if (
      newOrderStatus ===
        'paid' &&

      !orderRecord.paid_at
    ) {

      orderUpdate.paid_at =
        new Date()
          .toISOString();
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
        'Order Xendit fields update error:',
        paymentUpdateError
      );
    }


    /* -----------------------------------------------------
       13. STOCK MANAGEMENT
       ----------------------------------------------------- */

    /*
     * Kurangi stok hanya saat pertama
     * kali order berubah menjadi paid.
     */
    if (
      newOrderStatus ===
        'paid' &&

      orderRecord.status !==
        'paid' &&

      orderRecord.status !==
        'settled'
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
          'Stock deduction error:',
          stockError
        );
      }
    }


    /*
     * Restore stok kalau order direfund.
     */
    if (
      newOrderStatus ===
        'refunded' &&

      orderRecord.status !==
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
          'Stock restoration error:',
          stockError
        );
      }
    }


    /* -----------------------------------------------------
       14. STORE PAYMENT HISTORY
       ----------------------------------------------------- */

    const now =
      new Date()
        .toISOString();


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
              ? String(
                  paymentMethod
                )
              : 'xendit',

          gross_amount:
            grossAmount,

          transaction_status:
            event,

          fraud_status:
            null,

          payment_provider:
            'xendit',

          transaction_time:
            data?.created ||
            body?.created ||
            now,

          settlement_time:
            newOrderStatus ===
              'paid'
              ? now
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
       15. MARK PROCESSED
       ----------------------------------------------------- */

    processedCallbackMap.set(
      idempotencyKey,
      true
    );


    /* -----------------------------------------------------
       16. WEBHOOK RESPONSE
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

        payment_session_id:
          paymentSessionId,

        event:
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
      err?.message || err,
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
        .catch(
          () => ({})
        );


    const {
      order_number
    } = body;


    /* -----------------------------------------------------
       VALIDATION
       ----------------------------------------------------- */

    if (!order_number) {

      return errorResponse(
        c,
        'Order number is required',
        null,
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
        .maybeSingle();


    if (orderError) {

      console.error(
        'Order status lookup error:',
        orderError
      );


      return errorResponse(
        c,
        'Failed to check order',
        orderError.message,
        500
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
       GET XENDIT SESSION
       ----------------------------------------------------- */

    let xenditSession =
      null;


    if (
      order
        .payment_provider ===
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
          'Xendit session lookup error:',
          sessionError
        );
      }
    }


    /* -----------------------------------------------------
       GET PAYMENT HISTORY
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


    /* -----------------------------------------------------
       RESPONSE
       ----------------------------------------------------- */

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

        payment_id:
          order.payment_id,

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
      err?.message || err,
      500
    );
  }
};
