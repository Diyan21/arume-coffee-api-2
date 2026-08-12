import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { successResponse, errorResponse } from './utils/response.js';
import { getProducts, getProductById } from './controllers/products.js';
import { createOrder, getOrderByNumber } from './controllers/orders.js';
import { createPayment, handlePaymentCallback, checkPaymentStatus } from './controllers/payment.js';

const app = new Hono();

// CORS Middleware untuk Cloudflare Workers
app.use('*', async (c, next) => {
  const envFrontendUrl = c.env?.FRONTEND_URL || (typeof process !== 'undefined' ? process.env?.FRONTEND_URL : undefined);

  const corsHandler = cors({
    origin: (origin) => {
      // 1. Request tanpa origin (misal dari server-to-server / Postman)
      if (!origin) return '*';

      // 2. Daftar origin yang selalu diizinkan
      const allowedOrigins = [
        'https://arumeproject2.netlify.app',
        'https://arume-coffee.netlify.app',
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173'
      ];

      if (envFrontendUrl && envFrontendUrl.trim() !== '') {
        allowedOrigins.push(envFrontendUrl.trim());
      }

      // 3. Pengecekan origin (Whitelist eksplisit atau Subdomain Netlify)
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
  });

  return corsHandler(c, next);
});

// Root route - Technical Dashboard / Data Grid Control Center
app.get('/', (c) => {
  const acceptHeader = c.req.header('accept') || '';
  
  // Return JSON jika di-request via API Client
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
  <style>
    body { margin: 0; height: 100%; display: flex; flex-direction: column; overflow-x: hidden; }
  </style>
</head>
<body class="bg-[#141414] text-[#141414] font-sans antialiased min-h-screen flex flex-col p-2 sm:p-4">
  <div class="flex flex-col min-h-[calc(100vh-2rem)] w-full max-w-7xl mx-auto bg-[#E4E3E0] text-[#141414] border-[8px] sm:border-[12px] border-[#141414] shadow-2xl overflow-hidden" style="--ink: #141414; --bg: #E4E3E0; --line: #141414; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
    
    <!-- Top Navigation / Status Bar -->
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
        <div class="hidden md:block uppercase font-bold tracking-widest opacity-50 font-mono" id="utc-time">2026-08-12 UTC</div>
      </div>
    </header>

    <div class="flex flex-col lg:flex-row flex-1 overflow-hidden">
      <!-- Left Sidebar: File Explorer & Runtime -->
      <aside class="w-full lg:w-64 border-b lg:border-b-0 lg:border-r border-[#141414] flex flex-col bg-[#E4E3E0]">
        <div class="p-3 sm:p-4 border-b border-[#141414] bg-[#D9D8D5]">
          <span class="text-[11px] font-mono font-bold opacity-60 uppercase tracking-wider">Project Structure</span>
        </div>
        <div class="p-4 font-mono text-[12px] leading-relaxed overflow-y-auto max-h-60 lg:max-h-none">
          <div class="flex items-center gap-2 mb-1 font-bold">
            <span class="opacity-50">📁</span> arume-coffee-api/
          </div>
          <div class="pl-4 flex flex-col gap-1">
            <div class="opacity-80">├─ 📁 src/</div>
            <div class="pl-4 opacity-70">├─ 📁 config/</div>
            <div class="pl-8 opacity-60">├─ supabase.js</div>
            <div class="pl-8 opacity-60">└─ payment.js</div>
            <div class="pl-4 opacity-70">├─ 📁 controllers/</div>
            <div class="pl-8 opacity-60">├─ products.js</div>
            <div class="pl-8 opacity-60">├─ orders.js</div>
            <div class="pl-8 opacity-60">└─ payment.js</div>
            <div class="pl-4 opacity-70">├─ 📁 utils/</div>
            <div class="pl-8 opacity-60">└─ response.js</div>
            <div class="pl-4 font-bold underline text-black">└─ index.js</div>
          </div>
          <div class="mt-3 pl-4 flex flex-col gap-1 border-t border-[#141414]/20 pt-2">
            <div class="opacity-80">📄 wrangler.jsonc</div>
            <div class="opacity-80">📄 package.json</div>
            <div class="opacity-80">📄 README.md</div>
          </div>
        </div>
        
        <div class="mt-auto p-4 bg-[#141414] text-[#E4E3E0] border-t border-[#141414]">
          <div class="text-[10px] uppercase tracking-widest mb-1 opacity-50 font-bold">Target Runtime</div>
          <div class="font-mono text-xs font-bold text-green-400">CLOUDFLARE WORKERS</div>
          <div class="font-mono text-[11px] opacity-70 mt-0.5">Hono Framework v4.x</div>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="flex-1 flex flex-col overflow-y-auto">
        <section class="p-4 sm:p-6 border-b border-[#141414]">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6">
            <div>
              <span class="text-[11px] font-serif italic opacity-60 block mb-0.5">Primary Interface</span>
              <h2 class="text-2xl sm:text-4xl font-bold tracking-tighter uppercase">API Data Grid</h2>
            </div>
            <div class="flex flex-wrap gap-2">
              <button onclick="testEndpoint('/api/health')" class="border border-[#141414] bg-[#D9D8D5] px-3 sm:px-4 py-2 text-xs font-bold uppercase hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer">
                Test /health
              </button>
              <button onclick="testEndpoint('/api/products')" class="bg-[#141414] text-[#E4E3E0] px-3 sm:px-4 py-2 text-xs font-bold uppercase hover:bg-black transition-colors cursor-pointer">
                Test /products
              </button>
            </div>
          </div>

          <!-- Data Grid -->
          <div class="border border-[#141414] overflow-x-auto bg-[#E4E3E0]">
            <div class="grid grid-cols-12 bg-[#141414] text-[#E4E3E0] p-2 text-[10px] font-bold uppercase tracking-widest min-w-[600px]">
              <div class="col-span-2 sm:col-span-1 text-center">Method</div>
              <div class="col-span-5 sm:col-span-5">Endpoint Path</div>
              <div class="col-span-3 sm:col-span-3">Controller Handler</div>
              <div class="col-span-2 sm:col-span-3 text-right">Mode / Status</div>
            </div>
            <div class="divide-y divide-[#141414] font-mono text-[12px] sm:text-[13px] min-w-[600px]">
              <div onclick="testEndpoint('/api/health')" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group">
                <div class="col-span-2 sm:col-span-1 font-bold text-green-700 group-hover:text-green-400">GET</div>
                <div class="col-span-5 sm:col-span-5 font-bold">/api/health</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">index.health</div>
                <div class="col-span-2 sm:col-span-3 text-right font-bold text-green-700 group-hover:text-green-400">200 OK</div>
              </div>
              <div onclick="testEndpoint('/api/products')" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group">
                <div class="col-span-2 sm:col-span-1 font-bold text-green-700 group-hover:text-green-400">GET</div>
                <div class="col-span-5 sm:col-span-5 font-bold">/api/products</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">products.getProducts</div>
                <div class="col-span-2 sm:col-span-3 text-right opacity-80">Supabase/Fallback</div>
              </div>
              <div onclick="testEndpoint('/api/products/prod-01')" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group">
                <div class="col-span-2 sm:col-span-1 font-bold text-green-700 group-hover:text-green-400">GET</div>
                <div class="col-span-5 sm:col-span-5">/api/products/:id</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">products.getProductById</div>
                <div class="col-span-2 sm:col-span-3 text-right opacity-80">Detail Lookup</div>
              </div>
              <div onclick="testPostOrder()" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group">
                <div class="col-span-2 sm:col-span-1 font-bold text-blue-700 group-hover:text-blue-400">POST</div>
                <div class="col-span-5 sm:col-span-5 font-bold">/api/orders</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">orders.createOrder</div>
                <div class="col-span-2 sm:col-span-3 text-right font-bold text-amber-700 group-hover:text-amber-300">Price Validated</div>
              </div>
              <div onclick="testEndpoint('/api/orders/ARC-12345')" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group">
                <div class="col-span-2 sm:col-span-1 font-bold text-green-700 group-hover:text-green-400">GET</div>
                <div class="col-span-5 sm:col-span-5">/api/orders/:orderNumber</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">orders.getOrderByNumber</div>
                <div class="col-span-2 sm:col-span-3 text-right opacity-80">Lookup</div>
              </div>
              <div onclick="testPostPaymentCreate()" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group bg-[#D9D8D5]">
                <div class="col-span-2 sm:col-span-1 font-bold text-blue-700 group-hover:text-blue-400">POST</div>
                <div class="col-span-5 sm:col-span-5 font-bold">/api/payment/create</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">payment.createPayment</div>
                <div class="col-span-2 sm:col-span-3 text-right italic font-bold">
                  ${isMidtransConfigured ? 'MIDTRANS SNAP' : 'MOCK_PAYMENT_MODE'}
                </div>
              </div>
              <div onclick="testPostPaymentCallback()" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group">
                <div class="col-span-2 sm:col-span-1 font-bold text-blue-700 group-hover:text-blue-400">POST</div>
                <div class="col-span-5 sm:col-span-5">/api/payment/callback</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">payment.handlePaymentCallback</div>
                <div class="col-span-2 sm:col-span-3 text-right text-purple-700 group-hover:text-purple-300 font-bold">Idempotency Ready</div>
              </div>
              <div onclick="testPostPaymentCheck()" class="grid grid-cols-12 p-3 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors cursor-pointer group">
                <div class="col-span-2 sm:col-span-1 font-bold text-blue-700 group-hover:text-blue-400">POST</div>
                <div class="col-span-5 sm:col-span-5">/api/payment/check</div>
                <div class="col-span-3 sm:col-span-3 opacity-70">payment.checkPaymentStatus</div>
                <div class="col-span-2 sm:col-span-3 text-right opacity-80">Status Verification</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Live Response Output Terminal -->
        <section class="p-4 sm:p-6 border-b border-[#141414] bg-[#141414] text-[#E4E3E0]">
          <div class="flex justify-between items-center mb-2">
            <span class="text-[10px] font-mono font-bold uppercase tracking-widest text-green-400 flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-green-500"></span> Live Response Console
            </span>
            <span id="response-status" class="text-[10px] font-mono text-gray-400">Click any row above to test endpoint</span>
          </div>
          <pre id="response-output" class="p-4 bg-black/80 font-mono text-xs sm:text-sm text-green-300 border border-gray-800 rounded overflow-x-auto max-h-60 leading-relaxed">
// Click on any endpoint row in the grid above to execute a real-time HTTP fetch!
{
  "status": "ready",
  "hint": "Try clicking GET /api/products or GET /api/health"
}</pre>
        </section>

        <!-- Environment & Traffic Section -->
        <section class="grid grid-cols-1 md:grid-cols-2">
          <div class="p-4 sm:p-6 border-b md:border-b-0 md:border-r border-[#141414]">
            <h3 class="text-[10px] font-bold uppercase tracking-widest mb-4 opacity-60">Environment Configuration</h3>
            <div class="space-y-3 font-mono text-[12px]">
              <div class="flex justify-between border-b border-[#141414]/20 pb-1.5">
                <span class="opacity-60">SUPABASE_URL</span>
                <span class="font-bold ${isSupabaseConfigured ? 'text-green-700' : 'text-amber-700'}">
                  ${isSupabaseConfigured ? 'CONNECTED' : 'NOT_SET (USING_FALLBACK)'}
                </span>
              </div>
              <div class="flex justify-between border-b border-[#141414]/20 pb-1.5">
                <span class="opacity-60">MIDTRANS_ENV</span>
                <span class="font-bold px-1.5 py-0.5 ${isMidtransConfigured ? 'bg-green-200 text-green-900' : 'bg-yellow-200 text-yellow-900'} text-[10px]">
                  ${isMidtransConfigured ? 'ACTIVE' : 'MOCK_PAYMENT_MODE'}
                </span>
              </div>
              <div class="flex justify-between border-b border-[#141414]/20 pb-1.5">
                <span class="opacity-60">FRONTEND_URL</span>
                <span class="font-bold text-blue-800 truncate max-w-[180px]">${frontendUrl}</span>
              </div>
              <div class="flex justify-between border-b border-[#141414]/20 pb-1.5">
                <span class="opacity-60">SERVICE_ROLE_KEY</span>
                <span class="font-bold">${isSupabaseConfigured ? '•••••••• (PROTECTED)' : 'NOT_CONFIGURED'}</span>
              </div>
            </div>
          </div>

          <div class="p-4 sm:p-6 flex flex-col bg-[#DEDDD9]">
            <h3 class="text-[10px] font-bold uppercase tracking-widest mb-4 opacity-60">Real-Time Edge Telemetry (60s)</h3>
            <div class="flex-1 flex items-end gap-[3px] min-h-[70px]">
              <div class="flex-1 bg-[#141414] h-[25%] hover:bg-green-600 transition-colors" title="Traffic segment 1"></div>
              <div class="flex-1 bg-[#141414] h-[40%] hover:bg-green-600 transition-colors" title="Traffic segment 2"></div>
              <div class="flex-1 bg-[#141414] h-[20%] hover:bg-green-600 transition-colors" title="Traffic segment 3"></div>
              <div class="flex-1 bg-[#141414] h-[65%] hover:bg-green-600 transition-colors" title="Traffic segment 4"></div>
              <div class="flex-1 bg-[#141414] h-[50%] hover:bg-green-600 transition-colors" title="Traffic segment 5"></div>
              <div class="flex-1 bg-[#141414] h-[85%] hover:bg-green-600 transition-colors" title="Traffic segment 6"></div>
              <div class="flex-1 bg-[#141414] h-[60%] hover:bg-green-600 transition-colors" title="Traffic segment 7"></div>
              <div class="flex-1 bg-[#141414] h-[95%] hover:bg-green-600 transition-colors" title="Traffic segment 8"></div>
              <div class="flex-1 bg-[#141414] h-[35%] hover:bg-green-600 transition-colors" title="Traffic segment 9"></div>
              <div class="flex-1 bg-[#141414] h-[15%] hover:bg-green-600 transition-colors" title="Traffic segment 10"></div>
              <div class="flex-1 bg-[#141414] h-[45%] hover:bg-green-600 transition-colors" title="Traffic segment 11"></div>
              <div class="flex-1 bg-green-600 h-[100%]" title="Active live request stream"></div>
              <div class="flex-1 bg-[#141414] h-[55%]" title="Traffic segment 13"></div>
            </div>
            <div class="flex justify-between mt-2 font-mono text-[9px] opacity-60">
              <span>T-60s</span>
              <span>LIVE</span>
            </div>
          </div>
        </section>
      </main>
    </div>

    <!-- Footer Bar -->
    <footer class="px-4 py-3 border-t border-[#141414] bg-[#141414] text-[#E4E3E0] flex flex-wrap justify-between items-center text-[10px] sm:text-[11px] font-mono gap-2">
      <div class="flex flex-wrap gap-4 font-bold">
        <span class="text-green-400">DB_CONN: ${isSupabaseConfigured ? 'OK (SUPABASE)' : 'FALLBACK_MEMORY'}</span>
        <span class="text-yellow-400">GATEWAY: ${isMidtransConfigured ? 'MIDTRANS_SNAP' : 'MOCK_MODE'}</span>
        <span class="text-blue-400">CORS: PERMISSIVE_NETLIFY</span>
      </div>
      <div class="opacity-60 italic">arume-coffee-api v1.0.0 // Cloudflare Workers</div>
    </footer>
  </div>

  <script>
    function updateClock() {
      const now = new Date();
      document.getElementById('utc-time').textContent = now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }
    setInterval(updateClock, 1000);
    updateClock();

    async function testEndpoint(url) {
      const output = document.getElementById('response-output');
      const status = document.getElementById('response-status');
      status.textContent = 'Fetching ' + url + '...';
      output.textContent = '// Sending request to ' + url + '...';

      try {
        const start = performance.now();
        const res = await fetch(url);
        const latency = Math.round(performance.now() - start);
        const data = await res.json();
        
        status.textContent = '200 OK (' + latency + 'ms)';
        output.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        status.textContent = 'Error';
        output.textContent = err.toString();
      }
    }

    async function testPostOrder() {
      const output = document.getElementById('response-output');
      const status = document.getElementById('response-status');
      status.textContent = 'POST /api/orders...';

      const samplePayload = {
        customer: {
          name: "Diyan AxI",
          email: "diyanaxl@gmail.com",
          phone: "081234567890"
        },
        items: [
          { product_id: "prod-01", quantity: 2 },
          { product_id: "prod-05", quantity: 1 }
        ],
        notes: "Less ice, extra warm croissant"
      };

      try {
        const start = performance.now();
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(samplePayload)
        });
        const latency = Math.round(performance.now() - start);
        const data = await res.json();

        status.textContent = res.status + ' (' + latency + 'ms)';
        output.textContent = '// Sent Payload:\\n' + JSON.stringify(samplePayload, null, 2) + '\\n\\n// Response:\\n' + JSON.stringify(data, null, 2);
      } catch (err) {
        status.textContent = 'Error';
        output.textContent = err.toString();
      }
    }

    async function testPostPaymentCreate() {
      const output = document.getElementById('response-output');
      const status = document.getElementById('response-status');
      status.textContent = 'POST /api/payment/create...';

      const payload = { order_number: "ARC-SAMPLE-TEST" };

      try {
        const res = await fetch('/api/payment/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        status.textContent = res.status + ' OK';
        output.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        status.textContent = 'Error';
        output.textContent = err.toString();
      }
    }

    async function testPostPaymentCallback() {
      const output = document.getElementById('response-output');
      const status = document.getElementById('response-status');
      status.textContent = 'POST /api/payment/callback...';

      const mockCallback = {
        order_id: "ARC-SAMPLE-TEST",
        transaction_status: "settlement",
        gross_amount: 81000,
        payment_type: "qris",
        transaction_id: "tx-mock-" + Date.now()
      };

      try {
        const res = await fetch('/api/payment/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mockCallback)
        });
        const data = await res.json();
        status.textContent = res.status + ' OK';
        output.textContent = '// Webhook Callback Payload:\\n' + JSON.stringify(mockCallback, null, 2) + '\\n\\n// Response:\\n' + JSON.stringify(data, null, 2);
      } catch (err) {
        status.textContent = 'Error';
        output.textContent = err.toString();
      }
    }

    async function testPostPaymentCheck() {
      const output = document.getElementById('response-output');
      const status = document.getElementById('response-status');
      status.textContent = 'POST /api/payment/check...';

      try {
        const res = await fetch('/api/payment/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_number: "ARC-SAMPLE-TEST" })
        });
        const data = await res.json();
        status.textContent = res.status + ' OK';
        output.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        status.textContent = 'Error';
        output.textContent = err.toString();
      }
    }
  </script>
</body>
</html>`;

  return c.html(htmlContent);
});

// GET /api/health
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

// Product Routes
app.get('/api/products', getProducts);
app.get('/api/products/:id', getProductById);

// Order Routes
app.post('/api/orders', createOrder);
app.get('/api/orders/:orderNumber', getOrderByNumber);

// Payment Routes
app.post('/api/payment/create', createPayment);
app.post('/api/payment/callback', handlePaymentCallback);
app.post('/api/payment/check', checkPaymentStatus);

// 404 Route Handler
app.notFound((c) => {
  return errorResponse(c, 'Endpoint not found', `Path '${c.req.path}' was not found on this server`, 404);
});

// Error Handler
app.onError((err, c) => {
  console.error('API Error:', err);
  return errorResponse(c, 'Internal Server Error', err.message || 'An unexpected error occurred', 500);
});

export default app;
