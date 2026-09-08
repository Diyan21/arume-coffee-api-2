const normalizePhone =
(value) => {

  let phone =
    String(value || '')
      .replace(/[^0-9]/g, '')
      .trim();


  // 08xxxxxxxxxx -> 628xxxxxxxxxx
  if (
    phone.startsWith('0')
  ) {

    phone =
      `62${phone.slice(1)}`;
  }


  return phone;
};


const formatRupiahNumber =
(value) => {

  const number =
    Number(value || 0);


  return new Intl.NumberFormat(
    'id-ID'
  ).format(number);
};


/* =========================================================
   SEND ORDER PAYMENT SUCCESS TEMPLATE
   ========================================================= */

export const sendOrderPaymentSuccessWhatsApp =
async (
  env,
  {
    phoneNumber,
    customerName,
    orderNumber,
    total
  }
) => {

  if (
    !env?.WHATSAPP_ACCESS_TOKEN ||
    !env?.WHATSAPP_PHONE_NUMBER_ID ||
    !env?.WHATSAPP_GRAPH_API_VERSION
  ) {

    console.warn(
      'WhatsApp environment is incomplete'
    );

    return {
      success:
        false,

      skipped:
        true,

      reason:
        'WhatsApp configuration missing'
    };
  }


  const phone =
    normalizePhone(
      phoneNumber
    );


  if (
    !phone
  ) {

    return {
      success:
        false,

      skipped:
        true,

      reason:
        'Customer phone number missing'
    };
  }


  const graphVersion =
    String(
      env.WHATSAPP_GRAPH_API_VERSION
    ).trim();


  const phoneNumberId =
    String(
      env.WHATSAPP_PHONE_NUMBER_ID
    ).trim();


  const endpoint =
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`;


  const payload = {

    messaging_product:
      'whatsapp',

    recipient_type:
      'individual',

    to:
      phone,

    type:
      'template',

    template: {

      name:
        'order_payment_success',

      language: {

        code:
          'id'

      },

      components: [

        {

          type:
            'body',

          parameters: [

            {
              type:
                'text',

              text:
                String(
                  customerName ||
                  'Kak'
                )
            },

            {
              type:
                'text',

              text:
                String(
                  orderNumber ||
                  '-'
                )
            },

            {
              type:
                'text',

              text:
                formatRupiahNumber(
                  total
                )
            }

          ]

        }

      ]

    }

  };


  const response =
    await fetch(
      endpoint,
      {

        method:
          'POST',

        headers: {

          Authorization:
            `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,

          'Content-Type':
            'application/json'

        },

        body:
          JSON.stringify(
            payload
          )

      }
    );


  const data =
    await response.json();


  if (
    !response.ok
  ) {

    console.error(
      'WhatsApp template send error:',
      data
    );


    return {

      success:
        false,

      status:
        response.status,

      error:
        data?.error?.message ||
        'Failed to send WhatsApp template',

      meta:
        data

    };
  }


  return {

    success:
      true,

    whatsapp_message_id:
      data?.messages?.[0]?.id ||
      null,

    phone_number:
      phone

  };
};
