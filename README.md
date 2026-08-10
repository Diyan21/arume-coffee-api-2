# Arume Coffee API ☕

Backend API khusus **Arume Coffee** dibangun dari awal dengan **Hono framework**, ditargetkan untuk **Cloudflare Workers**, menggunakan **Supabase PostgreSQL** sebagai database utama, dan terintegrasi dengan **Midtrans Payment Gateway** (serta mendukung MOCK PAYMENT MODE secara otomatis jika Midtrans belum dikonfigurasi).

---

## 🛠️ Arsitektur & Teknologi

- **Backend Runtime:** Cloudflare Workers (Edge Computing)
- **Framework:** [Hono](https://hono.dev/)
- **Database:** Supabase PostgreSQL (`@supabase/supabase-js`)
- **Payment Gateway:** Midtrans Snap API (dengan MOCK PAYMENT MODE otomatis)
- **Frontend Target:** Hosted secara terpisah di Netlify

---

## 📁 Struktur Project

```
arume-coffee-api/
│
├── src/
│   ├── index.js              # Entry point utama Hono untuk Cloudflare Workers
│   ├── config/
│   │   ├── supabase.js       # Inisialisasi Supabase Client dengan Service Role Key
│   │   └── payment.js        # Service Midtrans Snap API & Mock Payment Engine
│   ├── controllers/
│   │   ├── products.js       # Logic Endpoint Produk (Catalog & Details)
│   │   ├── orders.js         # Logic Endpoint Order & Server-Side Price Validation
│   │   └── payment.js        # Logic Transaksi Payment & Webhook Callback (Idempotent)
│   └── utils/
│       └── response.js       # Helper Standardized JSON Response
│
├── package.json              # Minimal backend dependencies (Hono, Supabase, Wrangler)
├── wrangler.jsonc            # Konfigurasi Cloudflare Workers
├── .dev.vars.example         # Template Environment Variables lokal Wrangler
├── .gitignore                # File gitignore khusus Workers
└── README.md                 # Dokumentasi lengkap
```

---

## 1. Install Dependency

Jalankan perintah berikut di terminal project:

```bash
npm install
```

---

## 2. Local Development

Untuk menjalankan server API secara lokal menggunakan Cloudflare Wrangler:

1. Buat file `.dev.vars` dari contoh yang disediakan:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

2. Jalankan development server:
   ```bash
   npm run dev
   ```

Server lokal akan berjalan di `http://localhost:3000` (atau port default Wrangler).

---

## 3. Cloudflare Login

Sebelum melakukan deployment, pastikan Anda sudah login ke akun Cloudflare melalui CLI:

```bash
npx wrangler login
```

Ikuti instruksi di browser untuk mengotorisasi Wrangler CLI.

---

## 4. Environment Variables

Variabel lingkungan yang digunakan dalam aplikasi ini:

| Variable Name | Description | Mandatory / Secret |
| :--- | :--- | :--- |
| `SUPABASE_URL` | URL project Supabase Anda | Ya |
| `SUPABASE_SERVICE_ROLE_KEY` | Key Service Role Supabase (Hanya untuk backend) | **Secret** |
| `FRONTEND_URL` | URL Frontend Netlify (Contoh: `https://arume-coffee.netlify.app`) | Ya (CORS) |
| `MIDTRANS_SERVER_KEY` | Server Key Midtrans (KOSONGKAN jika ingin MOCK MODE) | **Secret** |
| `MIDTRANS_CLIENT_KEY` | Client Key Midtrans | Tidak |
| `MIDTRANS_ENVIRONMENT` | `sandbox` atau `production` | Tidak (Default: `sandbox`) |

### Menambahkan Secret di Cloudflare Workers Production:

Gunakan perintah `wrangler secret put` untuk mengatur secret sensitif di Cloudflare Workers:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put FRONTEND_URL
npx wrangler secret put MIDTRANS_SERVER_KEY
```

---

## 5. GitHub Deployment

Simpan repository ini ke GitHub dengan nama repository `arume-coffee-api`.

1. Inisialisasi Git dan Commit:
   ```bash
   git init
   git add .
   git commit -m "feat: initial Arume Coffee API implementation"
   ```

2. Connect ke GitHub Repository dan push:
   ```bash
   git remote add origin https://github.com/USERNAME/arume-coffee-api.git
   git branch -M main
   git push -u origin main
   ```

---

## 6. Cloudflare Deployment

Untuk melakukan deployment langsung ke Cloudflare Workers:

```bash
npx wrangler deploy
```

Atau atur **Cloudflare Pages / Workers Auto Build** pada Dashboard Cloudflare:
- **Build command:** `npm install`
- **Deploy command:** `npx wrangler deploy`

> **Catatan:** Jangan gunakan `npm run build` karena project ini adalah pure Backend API tanpa bundler frontend (Vite/React).

---

## 7. Supabase Setup (PostgreSQL Schema)

Buka **SQL Editor** pada Dashboard Supabase Anda, lalu eksekusi query berikut untuk membuat struktur tabel:

```sql
-- 1. Tabel Products (Produk Kopi & Pastry)
CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(12,2) NOT NULL,
  category VARCHAR(100) NOT NULL,
  image_url TEXT,
  stock INT NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabel Customers (Pelanggan)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabel Orders (Pesanan)
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(100) UNIQUE NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255),
  customer_phone VARCHAR(50),
  total_amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, paid, failed, cancelled
  notes TEXT,
  snap_token TEXT,
  payment_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tabel Order Items (Rincian Item Pesanan)
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  order_number VARCHAR(100) NOT NULL,
  product_id VARCHAR(100) REFERENCES products(id),
  product_name VARCHAR(255) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  quantity INT NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tabel Payments (Riwayat Transaksi Pembayaran)
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(100) NOT NULL,
  transaction_id VARCHAR(255) UNIQUE,
  payment_type VARCHAR(100),
  gross_amount DECIMAL(12,2) NOT NULL,
  transaction_status VARCHAR(100) NOT NULL,
  fraud_status VARCHAR(50),
  raw_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert Seed Initial Products
INSERT INTO products (id, name, description, price, category, image_url, stock, is_active) VALUES
('prod-01', 'Arume Signature Latte', 'Espresso blend pilihan dengan susu segar dan sirup aren organik.', 28000, 'Coffee', 'https://images.unsplash.com/photo-1541167760496-1628856ab772?w=600', 50, true),
('prod-02', 'Spanish Caramel Cold Brew', 'Cold brew direndam 16 jam dengan karamel gurih.', 32000, 'Coffee', 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=600', 40, true),
('prod-03', 'Uji Matcha Cream', 'Matcha grade A dari Uji, Kyoto disajikan dengan cold foam.', 35000, 'Non-Coffee', 'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=600', 30, true),
('prod-04', 'Butter Croissant', 'Croissant dipanggang segar tiap pagi dengan mentega Perancis.', 25000, 'Pastry', 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600', 20, true)
ON CONFLICT (id) DO NOTHING;
```

---

## 8. API Endpoints Specification

Semua response menggunakan format JSON yang konsisten.

### A. Health Check
- **`GET /api/health`**
- **Response:**
  ```json
  {
    "success": true,
    "message": "Arume Coffee API is running and healthy",
    "data": {
      "status": "ok",
      "service": "Arume Coffee API",
      "runtime": "Cloudflare Workers",
      "timestamp": "2026-08-09T21:52:30.000Z",
      "midtrans_configured": false,
      "supabase_configured": true
    }
  }
  ```

### B. Products Catalog
- **`GET /api/products`** (Opsional query parameter `?category=Coffee`)
- **`GET /api/products/:id`**

### C. Create Order (Server-Side Price Validation)
- **`POST /api/orders`**
- **Request Body:**
  ```json
  {
    "customer": {
      "name": "Budi Santoso",
      "email": "budi@example.com",
      "phone": "08123456789"
    },
    "items": [
      { "product_id": "prod-01", "quantity": 2 },
      { "product_id": "prod-04", "quantity": 1 }
    ],
    "notes": "Less ice untuk kopi"
  }
  ```
- **Keamanan:** Harga dihitung secara otomatis dari Database (Harga yang dikirim dari Frontend akan diabaikan demi keamanan).

### D. Get Order Details
- **`GET /api/orders/:orderNumber`**

### E. Payment Management
- **`POST /api/payment/create`**
  - **Body:** `{ "order_number": "ARC-1723456789-1234" }`
- **`POST /api/payment/callback`** (Webhook Notification Midtrans)
  - Fitur: Memiliki **Idempotency Check** dan **Signature Key Verification**.
- **`POST /api/payment/check`**
  - **Body:** `{ "order_number": "ARC-1723456789-1234" }`

---

## 9. Cara Menghubungkan Frontend Netlify

Pada project Frontend Arume Coffee yang di-host di Netlify, tambahkan Environment Variable di Netlify Dashboard atau file `.env`:

```env
VITE_API_URL=https://arume-coffee-api.<your-subdomain>.workers.dev
```

Contoh pemanggilan API dari Frontend React/Vite:

```javascript
const response = await fetch(`${import.meta.env.VITE_API_URL}/api/products`);
const result = await response.json();
console.log(result.data);
```

---

## 10. Cara Memasukkan Midtrans Setelah Akun Approved

Setelah akun Midtrans resmi Anda disetujui (Approved):

1. Dapatkan **Server Key** & **Client Key** dari [MAP (Midtrans Dashboard)](https://dashboard.midtrans.com/) pada menu **SETTINGS > ACCESS KEYS**.
2. Masukkan secret ke Cloudflare Workers:
   ```bash
   npx wrangler secret put MIDTRANS_SERVER_KEY
   ```
   *Ketikkan Server Key Anda (Contoh: `Mid-server-xxxxxxxxxxxx`)*

3. Atur environment jika di Production:
   ```bash
   npx wrangler secret put MIDTRANS_ENVIRONMENT
   ```
   *Isi dengan value: `production`*

4. Atur **Notification URL** (Callback Webhook) di Midtrans Dashboard pada menu **SETTINGS > CONFIGURATION**:
   - **Payment Notification URL:** `https://arume-coffee-api.<your-subdomain>.workers.dev/api/payment/callback`
   - **Finish Redirect URL:** `https://arume-coffee.netlify.app/order-success`
   - **Unfinish Redirect URL:** `https://arume-coffee.netlify.app/order-pending`
   - **Error Redirect URL:** `https://arume-coffee.netlify.app/order-failed`

---

*Arume Coffee API — Built with Hono & Cloudflare Workers ⚡*
