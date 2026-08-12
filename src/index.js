import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { successResponse, errorResponse } from './utils/response.js';
import { getProducts, getProductById } from './controllers/products.js';
import { createOrder, getOrderByNumber } from './controllers/orders.js';
import { createPayment, handlePaymentCallback, checkPaymentStatus } from './controllers/payment.js';

const app = new Hono();

// 1. Standar Middleware CORS bawaan Hono (Sangat Responsif untuk Preflight OPTIONS)
app.use('*', cors({
  origin: (origin) => {
    if (!origin) return '*';
    const allowedOrigins = [
      'https://arumeproject2.netlify.app',
      'https://arume-coffee.netlify.app',
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173'
    ];

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.netlify.app') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) {
      return origin;
    }
    return origin;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: true
}));

// Handled Preflight OPTIONS secara universal
app.options('*', (c) => c.text('', 204));

// 2. Health check
app.get('/api/health', (c) => {
  return successResponse(c, {
    status: 'ok',
    service: 'Arume Coffee API',
    runtime: 'Cloudflare Workers',
    timestamp: new Date().toISOString(),
    midtrans_configured: Boolean(c.env?.MIDTRANS_SERVER_KEY && c.env.MIDTRANS_SERVER_KEY.trim().length > 0),
    supabase_configured: Boolean(c.env?.SUPABASE_URL && c.env?.SUPABASE_SERVICE_ROLE_KEY)
  }, 'Arume Coffee API is running and healthy');
});

// 3. Product Routes
app.get('/api/products', getProducts);
app.get('/api/products/:id', getProductById);

// 4. Order Routes (Eksplisit)
app.post('/api/orders', createOrder);
app.get('/api/orders/:orderNumber', getOrderByNumber);

// 5. Payment Routes
app.post('/api/payment/create', createPayment);
app.post('/api/payment/callback', handlePaymentCallback);
app.post('/api/payment/check', checkPaymentStatus);

// Root route - Control Center Dashboard
app.get('/', (c) => {
  const acceptHeader = c.req.header('accept') || '';
  if (acceptHeader.includes('application/json') && !acceptHeader.includes('text/html')) {
    return c.json({
      service: 'Arume Coffee API',
      runtime: 'Cloudflare Workers',
      framework: 'Hono',
      version: '1.0.0',
      documentation: '/api/health for system status'
    });
  }

  const isMidtransConfigured = Boolean(c.env?.MIDTRANS_SERVER_KEY && c.env.MIDTRANS_SERVER_KEY.trim().length > 0);
  const isSupabaseConfigured = Boolean(c.env?.SUPABASE_URL && c.env?.SUPABASE_SERVICE_ROLE_KEY);
  const frontendUrl = c.env?.FRONTEND_URL || 'https://arumeproject2.netlify.app';

  const htmlContent = `<!doctype html>
<html lang="en" class="h-full">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Arume Coffee API — Control Center</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="bg-[#141414] text-[#141414] font-sans antialiased min-h-screen flex flex-col p-2 sm:p-4">
  <div class="flex flex-col min-h-[calc(100vh-2rem)] w-full max-w-7xl mx-auto bg-[#E4E3E0] text-[#141414] border-[8px] sm:border-[12px] border-[#141414] shadow-2xl overflow-hidden" style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    <header class="flex flex-wrap items-center justify-between px-4 sm:px-6 py-4 border-b border-[#141414] bg-[#E4E3E0]">
      <div class="flex items-center gap-3 sm:gap-4 mb-2 sm:mb-0">
        <div class="bg-[#141414] text-[#E4E3E0] px-3 py-1 font-mono text-xs sm:text-sm font-bold tracking-tighter">ARUME_API_V1</div>
        <h1 class="font-serif italic text-lg sm:text-xl font-medium">Control Center // Edge-Node-01</h1>
      </div>
      <div class="flex items-center gap-4 sm:gap-6 text-[10px] sm:text-xs">
        <div class="flex items-center gap-2">
          <div class="w-2.5 h-2.5 rounded-full bg-green-600 animate-pulse"></div>
          <span class="uppercase font-bold tracking-widest">Status: Live</span>
        </div>
      </div>
    </header>
    <main class="p-6">
      <h2 class="text-2xl font-bold mb-4">API Control Center Active</h2>
      <p class="font-mono text-sm">Target Worker: arume-coffee-api-2</p>
    </main>
  </div>
</body>
</html>`;

  return c.html(htmlContent);
});

// 404 Route Handler
app.notFound((c) => {
  return errorResponse(c, 'Endpoint not found', `Path '${c.req.path}' was not found on this server`, 404);
});

// Global Error Handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return errorResponse(c, 'Internal Server Error', err.message || 'An unexpected error occurred', 500);
});

export default app;
